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

/** True when `ref` resolves to a commit object in `repo`. */
function refResolvesToCommit(repo: string, ref: string): boolean {
  const probe = spawnSync(
    "git",
    ["-C", repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { encoding: "utf8" },
  );
  return probe.status === 0;
}

/**
 * The trunk this repo's branches fork from, as a ref that actually resolves.
 *
 * Tries, in order: the local branch named by `origin/HEAD`, that name's
 * remote-tracking ref (`origin/<name>`), then local/remote `main`/`master`.
 * The layered fallback keeps this robust when the local default branch was
 * renamed (e.g. main → master, where `origin/HEAD` still names the stale
 * "main" but only `origin/main`/`master` resolve) or never created (fresh
 * clone on a feature branch). Returns "HEAD" when nothing resolves, which
 * makes the merge-base below collapse to HEAD (uncommitted-only diff).
 */
function resolveDefaultBranch(repo: string): string {
  const candidates: string[] = [];
  const sym = spawnSync(
    "git",
    ["-C", repo, "symbolic-ref", "refs/remotes/origin/HEAD"],
    { encoding: "utf8" },
  );
  if (sym.status === 0) {
    const m = sym.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m) candidates.push(m[1]!, `origin/${m[1]!}`);
  }
  candidates.push("main", "master", "origin/main", "origin/master");
  for (const cand of candidates) {
    if (refResolvesToCommit(repo, cand)) return cand;
  }
  return "HEAD";
}

/**
 * The base commit to diff this repo's working tree against: the merge-base of
 * the trunk and HEAD — i.e. the point where this branch/worktree forked off.
 *
 * Diffing against the fork point (not the trunk's current tip) shows exactly
 * what THIS branch/worktree changed — committed branch work plus uncommitted
 * edits — and stays stable as the trunk advances (no reverse-diff noise). The
 * result depends only on the checkout, so every chat on the same branch or
 * worktree sees the same consolidated diff.
 *
 * Falls back to HEAD (uncommitted-only) when there is no merge-base: no trunk,
 * unrelated histories, or a branch that never diverged.
 */
function diffBase(repo: string): string {
  const trunk = resolveDefaultBranch(repo);
  const mb = spawnSync("git", ["-C", repo, "merge-base", trunk, "HEAD"], {
    encoding: "utf8",
  });
  const base = mb.status === 0 ? mb.stdout.trim() : "";
  return base || "HEAD";
}

/**
 * The full diff for one repo: tracked changes vs the fork-point base (committed
 * branch work + working-tree edits) plus untracked, non-ignored files rendered
 * as add-diffs. `git diff` alone omits untracked files, but new files an agent
 * just created are exactly what the user wants to see — so we append a
 * synthetic `--no-index` add-diff per untracked path. This is non-mutating (no
 * `git add -N`, so the user's index is untouched).
 */
function repoDiff(repo: string): string {
  const ref = diffBase(repo);
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
  // GET /diff?worktreePath=<abs>
  //
  // One total diff for the workspace: the root repo plus every independent
  // nested repo beneath it. Each repo is diffed against its own fork point
  // (merge-base of the trunk and HEAD) so the result is branch/worktree-scoped
  // — every chat on the same checkout sees the same consolidated diff. One
  // section per repo, labelled by its path relative to the workspace root.
  // Empty-diff repos are omitted.
  routes["/diff"] = async (_req, url) => {
    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    if (!worktreePath) {
      return jsonResponse({ error: "missing worktreePath" }, 400);
    }

    const repos = discoverRepos(worktreePath);
    const sections: DiffSection[] = [];
    for (const repo of repos) {
      const diff = repoDiff(repo);
      if (diff.trim().length === 0) continue;
      const label = path.relative(worktreePath, repo);
      sections.push({ kind: "whole", label, diff });
    }

    return jsonResponse({ sections }, 200);
  };
}
