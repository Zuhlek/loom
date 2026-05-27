import * as fs from "node:fs";
import * as path from "node:path";
import type { RefChangeFrame, ServerFrame } from "../chat-protocol/frames.ts";

export interface HeadWatcherOptions {
  emit: (frame: ServerFrame) => void;
  /** Debounce window for collapsing rapid HEAD writes. Default 200ms. */
  debounceMs?: number;
  /** Polling interval for the fs.watch-unavailable fallback. Default 2000ms. */
  pollMs?: number;
  /**
   * Injected `fs.watch` for tests — defaults to `node:fs.watch`. The
   * test surface needs to substitute a fake to assert refcount /
   * fallback semantics without depending on host-OS watch behaviour.
   */
  fsWatch?: typeof fs.watch;
}

export interface HeadSubscription {
  unsubscribe(): void;
}

export interface HeadWatcher {
  watch(projectCwd: string): HeadSubscription;
  dispose(): void;
}

interface WatcherEntry {
  refCount: number;
  fsWatcher: fs.FSWatcher | null;
  pollTimer: NodeJS.Timeout | null;
  debounceTimer: NodeJS.Timeout | null;
  lastBranch: string | null;
  lastMtimeMs: number;
  headPath: string;
}

function parseHead(contents: string): string | null {
  // `ref: refs/heads/<branch>\n` is the canonical attached-HEAD shape.
  // Detached-HEAD writes a bare sha — we don't surface a branch in that
  // case (return null and let the caller suppress the emission).
  const m = contents.match(/^ref:\s+refs\/heads\/(.+?)\s*$/m);
  return m ? m[1]! : null;
}

export function createHeadWatcher(opts: HeadWatcherOptions): HeadWatcher {
  const debounceMs = opts.debounceMs ?? 200;
  const pollMs = opts.pollMs ?? 2000;
  const fsWatch = opts.fsWatch ?? fs.watch;
  const entries = new Map<string, WatcherEntry>();

  function readAndMaybeEmit(cwd: string, entry: WatcherEntry): void {
    let raw: string;
    try {
      raw = fs.readFileSync(entry.headPath, "utf8");
    } catch {
      return;
    }
    const branch = parseHead(raw);
    if (!branch) return;
    if (branch === entry.lastBranch) return;
    entry.lastBranch = branch;
    const frame: RefChangeFrame = {
      kind: "ref-change",
      body: { cwd, branch },
    };
    opts.emit(frame);
  }

  function scheduleEmit(cwd: string, entry: WatcherEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      readAndMaybeEmit(cwd, entry);
    }, debounceMs);
  }

  function startEntry(cwd: string): WatcherEntry {
    const headPath = path.join(cwd, ".git", "HEAD");
    let initialBranch: string | null = null;
    try {
      initialBranch = parseHead(fs.readFileSync(headPath, "utf8"));
    } catch {
      /* missing HEAD — emit nothing until first write */
    }

    const entry: WatcherEntry = {
      refCount: 0,
      fsWatcher: null,
      pollTimer: null,
      debounceTimer: null,
      lastBranch: initialBranch,
      lastMtimeMs: 0,
      headPath,
    };

    try {
      entry.fsWatcher = fsWatch(headPath, () => scheduleEmit(cwd, entry));
    } catch {
      // Fall back to polling — network mounts and some non-FSEvents
      // filesystems throw from fs.watch().
      entry.pollTimer = setInterval(() => {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(headPath);
        } catch {
          return;
        }
        if (stat.mtimeMs !== entry.lastMtimeMs) {
          entry.lastMtimeMs = stat.mtimeMs;
          scheduleEmit(cwd, entry);
        }
      }, pollMs);
    }
    return entry;
  }

  function stopEntry(entry: WatcherEntry): void {
    if (entry.fsWatcher) {
      try {
        entry.fsWatcher.close();
      } catch {}
      entry.fsWatcher = null;
    }
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
  }

  return {
    watch(projectCwd) {
      let entry = entries.get(projectCwd);
      if (!entry) {
        entry = startEntry(projectCwd);
        entries.set(projectCwd, entry);
      }
      entry.refCount += 1;
      return {
        unsubscribe: () => {
          const e = entries.get(projectCwd);
          if (!e) return;
          e.refCount -= 1;
          if (e.refCount <= 0) {
            stopEntry(e);
            entries.delete(projectCwd);
          }
        },
      };
    },
    dispose() {
      for (const e of entries.values()) stopEntry(e);
      entries.clear();
    },
  };
}
