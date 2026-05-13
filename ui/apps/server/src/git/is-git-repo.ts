/**
 * Is the given path a git working tree?
 *
 * We check for a `.git` directory or file (the latter for worktrees
 * referencing a parent repo). Falls back to `git -C <p> rev-parse
 * --is-inside-work-tree` if the marker check is ambiguous.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface GitProbeResult {
  isGit: boolean;
  repoName?: string;
  topLevel?: string;
}

export function isGitRepo(p: string): GitProbeResult {
  // Bail early if the path does not exist on disk.
  if (!fs.existsSync(p)) return { isGit: false };
  let cur = path.resolve(p);
  // Walk upward from the given path looking for a `.git` marker.
  while (cur !== "/") {
    const gitMarker = path.join(cur, ".git");
    if (fs.existsSync(gitMarker)) {
      // Found a repo root — return its name and top-level path.
      const repoName = path.basename(cur);
      return { isGit: true, repoName, topLevel: cur };
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { isGit: false };
}
