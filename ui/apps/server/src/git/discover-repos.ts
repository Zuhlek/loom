/**
 * Discover the git repositories that make up a workspace: the root repo at
 * `rootPath` plus any independent nested repos beneath it.
 *
 * Used by the `/diff` route to aggregate one total diff across the workspace.
 * "Nested" means a directory carrying its own `.git` marker — a separately
 * cloned repo, not a submodule. We do NOT descend into a discovered repo to
 * look for deeper nesting: the result is a flat, predictable list.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { isGitRepo } from "./is-git-repo.ts";

/** Directories we never descend into while scanning for nested repos. */
const PRUNE = new Set(["node_modules", ".git"]);

/**
 * Returns `[root, ...nested]` (absolute paths) when `rootPath` is inside a git
 * repo, or `[]` when it is not. `maxDepth` bounds the walk relative to the
 * root so a deep tree can't stall the request.
 */
export function discoverRepos(rootPath: string, maxDepth = 4): string[] {
  const root = path.resolve(rootPath);
  if (!isGitRepo(root).isGit) return [];

  const repos: string[] = [root];

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip rather than fail the whole scan
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (PRUNE.has(name) || name.startsWith(".")) continue;
      const child = path.join(dir, name);
      if (fs.existsSync(path.join(child, ".git"))) {
        // Independent nested repo — record it and stop descending here.
        repos.push(child);
        continue;
      }
      walk(child, depth + 1);
    }
  };

  walk(root, 1);
  return repos;
}
