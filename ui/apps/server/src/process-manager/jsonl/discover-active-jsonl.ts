/**
 * jsonl/discover-active-jsonl.ts — directory-scan-based active JSONL
 * picker.
 *
 * Address `quality-review.md` M6 (Build rework #3): the bridge can no
 * longer trust `<persisted sessionId>.jsonl` as the filename to tail.
 * Claude has been observed to rotate its session-id out from under
 * loom — loom passes `--session-id 4e3dbe86-…` and claude ends up
 * writing to `ec847f04-…`. The persistent fix is to discover the file
 * by looking at what is on disk in the cwd-encoded projects directory.
 *
 * Strategy:
 *   1. List `.jsonl` files in `dir` (non-recursive).
 *   2. Pick the most-recently-modified file by mtime.
 *   3. Extract the inner `sessionId` from its first non-empty line via
 *      `schema.readSessionIdFromLine` (the only field-name-discipline
 *      sanctioned path).
 *
 * Returns `null` when the directory is absent or empty so the bridge
 * can fall back to the legacy synthesised path (used for fresh chats
 * before claude has written anything).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { readSessionIdFromLine } from "./schema.ts";

export interface DiscoveredJsonl {
  filePath: string;
  sessionId: string | null;
  mtimeMs: number;
}

export interface DiscoverOptions {
  /** Override for tests: returns the current wall-clock millis. */
  now?: () => number;
  /**
   * Informational ceiling on file age (millis since mtime). Files older
   * than this are still returned; callers decide whether to discard.
   * Reserved for future use; not consumed by the current logic.
   */
  maxAgeMs?: number;
}

/**
 * Return the most-recently-modified `.jsonl` file in `dir` together
 * with its inner `sessionId`, or `null` when none exists.
 *
 * Never throws on ENOENT / EACCES — those map to a `null` return.
 */
export async function discoverActiveJsonl(
  dir: string,
  _opts: DiscoverOptions = {},
): Promise<DiscoveredJsonl | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EACCES") {
      return null;
    }
    throw err;
  }

  type Candidate = { path: string; mtimeMs: number };
  const candidates: Candidate[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    let st: { isFile(): boolean; mtimeMs: number };
    try {
      st = await stat(path);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    candidates.push({ path, mtimeMs: st.mtimeMs });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chosen = candidates[0]!;

  let sessionId: string | null = null;
  try {
    const raw = await readFile(chosen.path, "utf8");
    const firstLine = firstNonEmptyLine(raw);
    if (firstLine !== null) {
      sessionId = readSessionIdFromLine(firstLine);
    }
  } catch {
    // Best-effort: a read failure leaves sessionId at null. The caller
    // still gets the file path so it can tail.
  }

  return {
    filePath: chosen.path,
    sessionId,
    mtimeMs: chosen.mtimeMs,
  };
}

function firstNonEmptyLine(text: string): string | null {
  let cur = 0;
  while (cur < text.length) {
    const nl = text.indexOf("\n", cur);
    const end = nl === -1 ? text.length : nl;
    const segment = text.slice(cur, end).trim();
    if (segment.length > 0) return segment;
    if (nl === -1) return null;
    cur = nl + 1;
  }
  return null;
}
