/**
 * jsonl/tail.ts — hybrid `fs.watch` primary + polling fallback line reader.
 *
 * Design ADR-003. Public surface is identical regardless of the underlying
 * strategy (polling forced by `forcePolling: true` for tests and
 * known-unreliable filesystems). The tail layer has zero JSONL knowledge —
 * it does not import from `schema.ts`. Its only public type is
 * `RawLine = { text, offset, fileVersion }`.
 *
 * Append-only reads: a truncation or unexpected file-shrink surfaces as a
 * `TailError` rather than silently rewinding. `fileVersion` increments on
 * (re-)open so consumers can detect rotation if the underlying inode is
 * replaced.
 */

import { open, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";

export type RawLine = {
  text: string;
  offset: number;
  fileVersion: number;
};

export interface TailError extends Error {
  code:
    | "OPEN_FAILED"
    | "READ_FAILED"
    | "TRUNCATION"
    | "WATCHER_DIED"
    | "DECODE_FAILED";
}

function makeTailError(code: TailError["code"], message: string): TailError {
  const e = new Error(message) as TailError;
  e.name = "TailError";
  (e as TailError).code = code;
  return e;
}

/**
 * `start` accepts EITHER the legacy synthesised triplet
 * `{tailRoot, encodedCwd, sessionId}` OR an explicit absolute
 * `{filePath}`. The explicit-path form is used by the bridge after
 * directory-scan discovery: claude can rotate its session-id out from
 * under loom, so the file actually being written may not match
 * `<sessionId>.jsonl`. Both forms converge on the same internal
 * file-path string.
 */
export type StartOpts =
  | { tailRoot: string; encodedCwd: string; sessionId: string }
  | { filePath: string };

export interface JsonlTail {
  start(opts: StartOpts): void;
  stop(): Promise<void>;
  onLine(cb: (line: RawLine) => void): () => void;
  onError(cb: (err: TailError) => void): () => void;
}

export interface TailOptions {
  pollingIntervalMs?: number; // default 250
  forcePolling?: boolean;
}

export function createJsonlTail(opts: TailOptions = {}): JsonlTail {
  const pollingIntervalMs = opts.pollingIntervalMs ?? 250;
  // ADR-003 hybrid contract:
  //   - `fs.watch` primary path drives `pollOnce()` reactively whenever
  //     the kernel reports a change. On platforms where `fs.watch`
  //     fires reliably (macOS FSEvents, Linux inotify), the polling
  //     loop coasts at a longer interval and acts purely as a fallback.
  //   - The polling interval (default 250 ms) is retained as a safety
  //     net for filesystems where `fs.watch` does not fire (NFS,
  //     certain Docker bind mounts) — those still surface new lines
  //     within `pollingIntervalMs` of arrival.
  //   - `forcePolling: true` disables `fs.watch` entirely so tests can
  //     assert the polling path in isolation.
  const forcePolling = opts.forcePolling === true;

  const lineListeners = new Set<(l: RawLine) => void>();
  const errorListeners = new Set<(e: TailError) => void>();

  let stopped = false;
  let started = false;
  let pollHandle: ReturnType<typeof setInterval> | undefined;
  let watcher: FSWatcher | undefined;
  let filePath = "";
  let cursor = 0; // byte offset within the current file version
  let fileVersion = 0;
  let lastInode: number | undefined; // detect rotation
  let buffer = ""; // partial line carry-over
  let pollInFlight = false;

  function schedulePoll(): void {
    if (pollInFlight || stopped) return;
    pollInFlight = true;
    pollOnce()
      .catch((err) => {
        emitError(
          makeTailError("READ_FAILED", `tail: poll loop crashed: ${String(err)}`),
        );
      })
      .finally(() => {
        pollInFlight = false;
      });
  }

  function emitLine(text: string, offset: number): void {
    const line: RawLine = { text, offset, fileVersion };
    for (const cb of lineListeners) {
      try {
        cb(line);
      } catch {
        /* listener exceptions should not break the tail */
      }
    }
  }

  function emitError(err: TailError): void {
    for (const cb of errorListeners) {
      try {
        cb(err);
      } catch {
        /* swallow */
      }
    }
  }

  function flushBuffer(chunk: string, lineBaseOffset: number): void {
    // chunk arrives as the concatenation of the carry-over buffer + the
    // new bytes; emit complete lines and keep any trailing partial.
    let combined = buffer + chunk;
    buffer = "";
    let cur = 0;
    let nl = combined.indexOf("\n", cur);
    while (nl !== -1) {
      const text = combined.slice(cur, nl);
      // offset semantics: the offset where the line was emitted (start of
      // line in the file). We compute as lineBaseOffset (start of chunk)
      // + cur - (length of original buffer at start).
      const emittedOffset = lineBaseOffset + cur;
      emitLine(text, emittedOffset);
      cur = nl + 1;
      nl = combined.indexOf("\n", cur);
    }
    // Anything left after the last newline is a partial line for the next tick.
    buffer = combined.slice(cur);
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    let st: { size: number; ino: number } | undefined;
    try {
      const s = await stat(filePath);
      st = { size: s.size, ino: s.ino };
    } catch (err) {
      // File doesn't exist yet — that's fine, wait for it.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // If we previously had a file, this is rotation — bump fileVersion
        // when it reappears.
        if (lastInode !== undefined) {
          lastInode = undefined;
        }
        return;
      }
      emitError(makeTailError("READ_FAILED", `tail: stat failed: ${String(err)}`));
      return;
    }
    if (st === undefined) return;

    // Rotation detection: inode changed → file replaced.
    if (lastInode !== undefined && st.ino !== lastInode) {
      fileVersion += 1;
      cursor = 0;
      buffer = "";
    } else if (lastInode === undefined) {
      fileVersion += 1;
      cursor = 0;
      buffer = "";
    }
    lastInode = st.ino;

    if (st.size < cursor) {
      // Truncation (or shrink). Surface as a TailError per the
      // append-only contract. We do not silently rewind.
      const err = makeTailError(
        "TRUNCATION",
        `tail: file shrank from ${cursor} to ${st.size} bytes (truncation); refusing to rewind`,
      );
      emitError(err);
      // After surfacing the error, treat this as a rotation: start over
      // so subsequent appends can still be tailed.
      cursor = 0;
      buffer = "";
      fileVersion += 1;
      return;
    }
    if (st.size === cursor) return;

    // Read the new bytes.
    let chunk = "";
    try {
      const fh = await open(filePath, "r");
      try {
        const toRead = st.size - cursor;
        const buf = Buffer.allocUnsafe(toRead);
        const { bytesRead } = await fh.read(buf, 0, toRead, cursor);
        chunk = buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await fh.close();
      }
    } catch (err) {
      emitError(makeTailError("READ_FAILED", `tail: read failed: ${String(err)}`));
      return;
    }

    const chunkBaseOffset = cursor;
    cursor = st.size;
    flushBuffer(chunk, chunkBaseOffset);
  }

  return {
    start(startOpts) {
      if (started) return;
      started = true;
      let watchTargetName: string;
      if ("filePath" in startOpts) {
        filePath = startOpts.filePath;
        // The watch listener filters parent-dir events by basename so it
        // only reacts to its own file. Compute the basename here.
        const slash = filePath.lastIndexOf("/");
        watchTargetName = slash >= 0 ? filePath.slice(slash + 1) : filePath;
      } else {
        const { tailRoot, encodedCwd, sessionId } = startOpts;
        filePath = join(tailRoot, encodedCwd, `${sessionId}.jsonl`);
        watchTargetName = `${sessionId}.jsonl`;
      }
      // Polling timer is the fallback / safety-net path. It runs at
      // `pollingIntervalMs` regardless of whether the watcher is
      // active, so filesystems where `fs.watch` does not fire still
      // surface new lines.
      pollHandle = setInterval(schedulePoll, pollingIntervalMs);
      // Kick once immediately so tests see fast first reads.
      schedulePoll();
      // fs.watch primary path. Watch the parent directory so we still
      // get events when the file is rotated (the inode changes;
      // a watcher bound to the file would lose its target). When the
      // watcher emits for our file, kick a poll. If the watcher errors
      // or the platform doesn't fire events, the polling timer above
      // takes over silently.
      if (!forcePolling) {
        try {
          const dir = dirname(filePath);
          watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
            if (stopped) return;
            // Only react to events for our session's JSONL file. The
            // claude projects directory holds one JSONL per chat;
            // events for siblings should not trigger a read of ours.
            if (filename && filename !== watchTargetName) return;
            schedulePoll();
          });
          watcher.on("error", () => {
            // fs.watch crashed (NFS / unsupported FS) — polling
            // continues to drive line emission, so swallow.
          });
        } catch {
          // Platform / permission failure — polling-only mode.
          watcher = undefined;
        }
      }
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = undefined;
      }
      if (watcher) {
        try { watcher.close(); } catch {}
        watcher = undefined;
      }
      lineListeners.clear();
      errorListeners.clear();
    },

    onLine(cb) {
      if (stopped) {
        // Per the contract, post-stop subscriptions get zero callbacks.
        return () => {};
      }
      lineListeners.add(cb);
      return () => {
        lineListeners.delete(cb);
      };
    },

    onError(cb) {
      if (stopped) return () => {};
      errorListeners.add(cb);
      return () => {
        errorListeners.delete(cb);
      };
    },
  };
}
