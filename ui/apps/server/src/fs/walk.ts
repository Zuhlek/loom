/**
 * Bounded recursive file walk for the @-file picker.
 *
 * Best-effort .gitignore awareness: we honor a small fixed list
 * (node_modules, .git, dist, build, .next, .turbo, coverage). A
 * full .gitignore parser is intentionally out-of-scope per plan.md
 * "Lean changes only".
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".idea",
  ".vscode",
  ".cache",
  ".pytest_cache",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".DS_Store",
]);

export interface WalkOptions {
  maxFiles?: number;
}

export function walkCwd(root: string, opts: WalkOptions = {}): string[] {
  const max = opts.maxFiles ?? 5000;
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        out.push(path.relative(root, full));
      }
    }
  }
  return out;
}

/**
 * Simple subsequence-fuzzy ranking: lower score = better.
 * Returns matches with the original path; caller slices for display.
 */
export function fuzzyRank(query: string, items: string[], limit = 30): string[] {
  if (!query) return items.slice(0, limit);
  const q = query.toLowerCase();
  const scored: { item: string; score: number }[] = [];
  for (const item of items) {
    const lc = item.toLowerCase();
    let score = subsequenceScore(q, lc);
    if (score === Infinity) continue;
    scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((x) => x.item);
}

function subsequenceScore(q: string, target: string): number {
  // Returns Infinity if not a subsequence.
  let qi = 0;
  let lastIdx = -1;
  let gaps = 0;
  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i] === q[qi]) {
      if (lastIdx !== -1) gaps += i - lastIdx - 1;
      lastIdx = i;
      qi++;
    }
  }
  if (qi < q.length) return Infinity;
  // Prefer earlier matches and shorter gaps.
  return gaps + lastIdx;
}
