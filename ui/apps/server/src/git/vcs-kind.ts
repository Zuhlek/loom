// VCS-kind detection with process-lifetime cache, invalidated by worktree CRUD.
import * as fs from "node:fs";
import * as path from "node:path";

export type VcsKind = "git" | "unknown";

const cache = new Map<string, VcsKind>();

// Test-introspectable counter for filesystem probes. The injected check
// is the only path; tests assert via `__getProbeCount()` that a cache hit
// does not increment the counter (the chat-attach AC2 contract).
let probeCount = 0;

function probe(cwd: string): VcsKind {
  let cur = path.resolve(cwd);
  // Walk up to filesystem root. `path.dirname("/") === "/"` is the
  // termination condition on POSIX; Windows behaves similarly.
  while (true) {
    probeCount += 1;
    if (fs.existsSync(path.join(cur, ".git"))) return "git";
    const parent = path.dirname(cur);
    if (parent === cur) return "unknown";
    cur = parent;
  }
}

export function detectVcsKind(cwd: string): VcsKind {
  const key = path.resolve(cwd);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = probe(key);
  cache.set(key, result);
  return result;
}

export function invalidateVcsKindCache(cwd?: string): void {
  if (cwd === undefined) {
    cache.clear();
    return;
  }
  const key = path.resolve(cwd);
  // Invalidate the exact cwd plus any descendants — `removeWorktree`
  // can flip the answer for the worktree path and any nested paths
  // under it.
  for (const k of cache.keys()) {
    if (k === key || k.startsWith(key + path.sep)) cache.delete(k);
  }
}

/** Test-only: drop the entire cache between tests. */
export function __resetVcsKindCacheForTests(): void {
  cache.clear();
  probeCount = 0;
}

/** Test-only: count of filesystem probes since process start (or last reset). */
export function __getProbeCount(): number {
  return probeCount;
}
