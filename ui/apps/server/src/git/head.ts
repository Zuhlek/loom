import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Parse the branch name out of a `.git/HEAD` payload. `ref: refs/heads/<branch>`
 * is the canonical attached-HEAD shape; a detached HEAD writes a bare sha, for
 * which we surface no branch (return null).
 */
export function parseHeadRef(contents: string): string | null {
  const m = contents.match(/^ref:\s+refs\/heads\/(.+?)\s*$/m);
  return m ? m[1]! : null;
}

/**
 * Read the current branch from `<repoTopLevel>/.git/HEAD`, or null when the
 * file is unreadable (transient I/O, detached HEAD, or a gitfile worktree
 * whose HEAD lives elsewhere). Synchronous and fs-only, mirroring the
 * head-watcher — no `git` subprocess.
 */
export function readCurrentBranch(repoTopLevel: string): string | null {
  try {
    return parseHeadRef(fs.readFileSync(path.join(repoTopLevel, ".git", "HEAD"), "utf8"));
  } catch {
    return null;
  }
}
