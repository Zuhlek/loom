/**
 * jsonl-path-probe.ts — first-run discovery of the tail-root directory
 * `claude` writes its JSONL transcripts under.
 *
 * The probe is empirical: rather than hard-code
 * `~/.claude/projects/...`, it:
 *
 *   1. Picks a candidate root (`~/.claude` by default; injectable via
 *      `driver.discoverRoots()`).
 *   2. Starts watching the root for new files.
 *   3. Drives a short benign `claude` session via the driver.
 *   4. Waits until a `.jsonl` file appears under the root; reads back the
 *      first directory segment that segments the cwd-encoded path.
 *   5. Persists the resolved tail-root.
 *
 * Failure mode: if the probe times out without observing a new JSONL
 * file, `resolve()` / `reprobe()` reject with `ProbeError` carrying
 * actionable text. The bridge surfaces this as a startup error rather
 * than starting an empty tail.
 *
 * The `driver` interface keeps the side-effectful pieces (filesystem
 * roots, the `claude` invocation, the `claude --version` shell-out) out
 * of the pure probe core so unit tests can drive it deterministically.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { watch } from "node:fs";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

export class ProbeError extends Error {
  readonly code: string;
  constructor(message: string, code = "PROBE_TIMEOUT") {
    super(message);
    this.name = "ProbeError";
    this.code = code;
  }
}

export interface ResolvedTailRoot {
  tailRoot: string;
  encodingScheme: "cwd-slash-encoded";
  resolvedAt: string;
  claudeVersionAtProbe: string;
}

export interface ProbeMeta {
  probeSessionId: string;
  encodedCwd: string;
  cwd: string;
}

export interface ProbeDriver {
  /** Return candidate roots to watch. The probe takes the first one. */
  discoverRoots(): string[];
  /**
   * Drive a benign `claude` session that produces a JSONL file under one
   * of the candidate roots. Tests inject a no-op + manual file-write
   * driver; production wires this to a real `claude --print` invocation.
   */
  invokeClaudeBenignSession(meta: ProbeMeta): Promise<void>;
  /** Best-effort `claude --version`. */
  getClaudeVersion(): Promise<string>;
}

export interface JsonlPathProbe {
  resolve(): Promise<ResolvedTailRoot>;
  reprobe(): Promise<ResolvedTailRoot>;
  encodeCwd(cwd: string): string;
}

export interface JsonlPathProbeOptions {
  storagePath: string;
  timeoutMs?: number;
  driver?: ProbeDriver;
}

/**
 * Claude's cwd-encoding scheme.
 *
 * Observed on the user's host (claude 2.x): both `/` AND ` ` are
 * replaced with `-` when materialising the projects-directory name.
 * Example: `/Volumes/My Shared Files/repo/loom` →
 * `-Volumes-My-Shared-Files-repo-loom`. Whitespace handling was the
 * second M6 root cause — loom's original `/` → `-` scheme produced
 * `-Volumes-My Shared Files-repo-loom` (with embedded spaces), which
 * does not match the directory claude actually writes to.
 */
export function encodeCwd(cwd: string): string {
  // Replace path separators and whitespace with `-`. Collapses any
  // run of these characters into a single dash to match claude's
  // observed normalisation (consecutive separators don't produce
  // empty path segments in the encoded name).
  return cwd.replace(/[\s/]+/g, "-");
}

/** Default driver: production wiring. */
export function defaultDriver(): ProbeDriver {
  return {
    discoverRoots() {
      return [join(homedir(), ".claude")];
    },
    async invokeClaudeBenignSession(meta) {
      // Spawn a short `claude --print --session-id <id>` with a benign
      // prompt. The output is discarded; we care about the JSONL side
      // effect under the root.
      try {
        await execFileP(
          "claude",
          ["--print", "--session-id", meta.probeSessionId, "ping"],
          {
            cwd: meta.cwd,
            timeout: 20_000,
          },
        );
      } catch {
        // Even if claude exits non-zero, it may still have produced the
        // JSONL file. Let the watcher decide.
      }
    },
    async getClaudeVersion() {
      try {
        const { stdout } = await execFileP("claude", ["--version"], { timeout: 5000 });
        return stdout.trim();
      } catch {
        return "unknown";
      }
    },
  };
}

async function readPersisted(storagePath: string): Promise<ResolvedTailRoot | undefined> {
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as ResolvedTailRoot;
    if (parsed && typeof parsed.tailRoot === "string" && parsed.tailRoot.length > 0) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function writePersisted(storagePath: string, value: ResolvedTailRoot): Promise<void> {
  await mkdir(dirname(storagePath), { recursive: true });
  const tmp = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, storagePath);
}

function waitForJsonl(
  watchedRoot: string,
  probeSessionId: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      reject(
        new ProbeError(
          `jsonl-path-probe timed out after ${timeoutMs}ms without observing a JSONL file under ${watchedRoot}. ` +
            `Verify that the 'claude' binary is installed, on PATH, and able to write transcripts to its data dir. ` +
            `Run 'claude --version' to confirm; re-run the probe via the loom 'reprobe' admin endpoint.`,
        ),
      );
    }, timeoutMs);

    const watcher = watch(watchedRoot, { recursive: true }, (eventType, filename) => {
      if (settled) return;
      if (!filename) return;
      const name = filename.toString();
      if (!name.endsWith(".jsonl")) return;
      if (!name.includes(probeSessionId)) return;
      settled = true;
      clearTimeout(timer);
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      // The full path to the observed file.
      resolve(join(watchedRoot, name));
    });

    watcher.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ProbeError(`jsonl-path-probe watcher error: ${String(err)}`, "PROBE_WATCH"));
    });
  });
}

function deriveTailRootFromObservedFile(observedFilePath: string): string {
  // observedFile: <root>/projects/<encodedCwd>/<sessionId>.jsonl
  // tailRoot:    <root>/projects
  // Walk up two levels to land on the tail-root.
  const enc = dirname(observedFilePath); // .../projects/<encodedCwd>
  return dirname(enc);                   // .../projects
}

export function createJsonlPathProbe(opts: JsonlPathProbeOptions): JsonlPathProbe {
  const driver = opts.driver ?? defaultDriver();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const storagePath = opts.storagePath;

  async function runProbe(): Promise<ResolvedTailRoot> {
    const roots = driver.discoverRoots();
    if (roots.length === 0) {
      throw new ProbeError(
        "jsonl-path-probe: no candidate roots returned from driver. " +
          "Ensure ~/.claude exists or pass an explicit root via driver injection.",
        "PROBE_NO_ROOTS",
      );
    }
    const observeRoot = roots[0]!;
    await mkdir(observeRoot, { recursive: true });
    const probeSessionId = randomUUID();
    const cwd = process.cwd();
    const encoded = encodeCwd(cwd);
    const meta: ProbeMeta = {
      probeSessionId,
      encodedCwd: encoded,
      cwd,
    };

    // Start the watcher BEFORE driving `claude` to avoid a race where the
    // file appears before we attach.
    const waiter = waitForJsonl(observeRoot, probeSessionId, timeoutMs);

    // Drive claude in parallel with the watcher.
    driver.invokeClaudeBenignSession(meta).catch(() => {
      /* watcher timeout will surface; driver errors are non-fatal here */
    });

    const observed = await waiter;
    const tailRoot = deriveTailRootFromObservedFile(observed);

    const claudeVersionAtProbe = await driver.getClaudeVersion().catch(() => "unknown");
    const resolved: ResolvedTailRoot = {
      tailRoot,
      encodingScheme: "cwd-slash-encoded",
      resolvedAt: new Date().toISOString(),
      claudeVersionAtProbe,
    };
    await writePersisted(storagePath, resolved);
    return resolved;
  }

  return {
    async resolve() {
      const persisted = await readPersisted(storagePath);
      if (persisted) return persisted;
      return runProbe();
    },
    async reprobe() {
      return runProbe();
    },
    encodeCwd(cwd) {
      return encodeCwd(cwd);
    },
  };
}
