import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { jsonResponse } from "./_response.ts";
import { discoverRepos } from "../git/discover-repos.ts";

export interface DiffSection {
  kind: "whole";
  /** Repo path relative to the workspace root; "" for the root repo. */
  label: string;
  diff: string;
}

/**
 * Resolve the base ref to diff against for a single repo. Nested repos often
 * lack the root repo's base branch (e.g. "main"), so fall back to HEAD —
 * which yields the working-tree (uncommitted) diff — when `base` is absent.
 */
function effectiveBase(repo: string, base: string): string {
  const probe = spawnSync(
    "git",
    ["-C", repo, "rev-parse", "--verify", "--quiet", `${base}^{commit}`],
    { encoding: "utf8" },
  );
  return probe.status === 0 ? base : "HEAD";
}

/**
 * The full diff for one repo: tracked changes vs `base` (committed +
 * working-tree edits) plus untracked, non-ignored files rendered as
 * add-diffs. `git diff` alone omits untracked files, but new files an
 * agent just created are exactly what the user wants to see — so we
 * append a synthetic `--no-index` add-diff per untracked path. This is
 * non-mutating (no `git add -N`, so the user's index is untouched).
 */
function repoDiff(repo: string, base: string): string {
  const ref = effectiveBase(repo, base);
  const tracked =
    spawnSync("git", ["-C", repo, "diff", ref, "--unified=3"], {
      encoding: "utf8",
    }).stdout ?? "";

  const othersOut =
    spawnSync(
      "git",
      ["-C", repo, "ls-files", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    ).stdout ?? "";
  const untrackedPaths = othersOut
    .split("\0")
    .filter(Boolean)
    // Trailing-slash entries are embedded-repo boundaries (git won't
    // descend into a nested repo). Those repos get their own section via
    // `discoverRepos`, so skip them here — otherwise `--no-index` would
    // recurse and leak the child's files into the parent's diff.
    .filter((rel) => !rel.endsWith("/"));

  let untracked = "";
  for (const rel of untrackedPaths) {
    // `--no-index` exits 1 when the files differ; stdout still holds the
    // diff. The header comes out as `diff --git a/<rel> b/<rel>` with a
    // `new file mode` line, which the unified-diff parser handles.
    const r = spawnSync(
      "git",
      ["-C", repo, "diff", "--no-index", "--unified=3", "--", "/dev/null", rel],
      { encoding: "utf8" },
    );
    untracked += r.stdout ?? "";
  }

  return tracked + untracked;
}

export function mountDiffRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  // GET /diff?worktreePath=<abs>&base=<ref>
  //
  // One total diff for the workspace: the root repo plus every independent
  // nested repo beneath it, each compared against `base` (committed +
  // uncommitted). One section per repo, labelled by its path relative to the
  // workspace root. Empty-diff repos are omitted.
  routes["/diff"] = async (_req, url) => {
    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    const base = url.searchParams.get("base") ?? "main";
    if (!worktreePath) {
      return jsonResponse({ error: "missing worktreePath" }, 400);
    }

    const repos = discoverRepos(worktreePath);
    const sections: DiffSection[] = [];
    for (const repo of repos) {
      const diff = repoDiff(repo, base);
      if (diff.trim().length === 0) continue;
      const label = path.relative(worktreePath, repo);
      sections.push({ kind: "whole", label, diff });
    }

    return jsonResponse({ sections }, 200);
  };
}
