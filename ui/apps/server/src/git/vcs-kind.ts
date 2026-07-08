// VCS-kind detection with process-lifetime cache, invalidated by worktree CRUD.
import * as path from "node:path";
import { probeGitMarker } from "./git-marker.ts";

export type VcsKind = "git" | "unknown";

const cache = new Map<string, VcsKind>();

// Test-introspectable counter for filesystem probes. The injected check
// is the only path; tests assert via `__getProbeCount()` that a cache hit
// does not increment the counter (the chat-attach AC2 contract).
let probeCount = 0;

// `null` means "couldn't determine" (a filesystem I/O error interrupted the
// walk) — distinct from "unknown", which is a confirmed non-git tree. We
// neither cache nor persist `null`, so the answer self-heals on the next
// probe once the mount recovers.
function probe(cwd: string): VcsKind | null {
  let cur = path.resolve(cwd);
  // Walk up to filesystem root. `path.dirname("/") === "/"` is the
  // termination condition on POSIX; Windows behaves similarly.
  while (true) {
    probeCount += 1;
    const marker = probeGitMarker(cur);
    if (marker === "present") return "git";
    if (marker === "error") return null;
    const parent = path.dirname(cur);
    if (parent === cur) return "unknown";
    cur = parent;
  }
}

export function detectVcsKind(cwd: string): VcsKind | null {
  const key = path.resolve(cwd);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = probe(key);
  if (result !== null) cache.set(key, result);
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
