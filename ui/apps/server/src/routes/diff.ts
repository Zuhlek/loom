import * as fs from "node:fs";
import * as path from "node:path";

import { jsonResponse } from "./_response.ts";
import { discoverRepos } from "../git/discover-repos.ts";
import { executeGit } from "../git/worktree.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { CheckpointStore } from "../checkpointing/checkpoint-store.ts";

export interface DiffSection {
  kind: "whole";
  /** Repo path relative to the workspace root; "" for the root repo. */
  label: string;
  diff: string;
}

/** True when `ref` resolves to a commit object in `repo`. */
async function refResolvesToCommit(repo: string, ref: string): Promise<boolean> {
  const probe = await executeGit(
    repo,
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { allowNonZeroExit: true },
  );
  return probe.exitCode === 0;
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
async function resolveDefaultBranch(repo: string): Promise<string> {
  const candidates: string[] = [];
  const sym = await executeGit(
    repo,
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    { allowNonZeroExit: true },
  );
  if (sym.exitCode === 0) {
    const m = sym.stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (m) candidates.push(m[1]!, `origin/${m[1]!}`);
  }
  candidates.push("main", "master", "origin/main", "origin/master");
  for (const cand of candidates) {
    if (await refResolvesToCommit(repo, cand)) return cand;
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
async function diffBase(repo: string): Promise<string> {
  const trunk = await resolveDefaultBranch(repo);
  const mb = await executeGit(repo, ["merge-base", trunk, "HEAD"], {
    allowNonZeroExit: true,
  });
  const base = mb.exitCode === 0 ? mb.stdout.trim() : "";
  return base || "HEAD";
}

/**
 * The full diff for one repo: tracked changes vs the fork-point base (committed
 * branch work + working-tree edits) plus untracked, non-ignored files rendered
 * as add-diffs. `git diff` alone omits untracked files, but new files an agent
 * just created are exactly what the user wants to see — so we append a
 * synthetic `--no-index` add-diff per untracked path. This is non-mutating (no
 * `git add -N`, so the user's index is untouched).
 *
 * `baseOverride`, when given, replaces the computed fork-point base — used to
 * diff a worktree-mode root against its chat-start checkpoint.
 */
async function repoDiff(repo: string, baseOverride?: string): Promise<string> {
  const ref = baseOverride ?? (await diffBase(repo));
  const tracked =
    (await executeGit(repo, ["diff", ref, "--unified=3"], {
      allowNonZeroExit: true,
    })).stdout ?? "";

  const othersOut =
    (await executeGit(
      repo,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { allowNonZeroExit: true },
    )).stdout ?? "";
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
    const r = await executeGit(
      repo,
      ["diff", "--no-index", "--unified=3", "--", "/dev/null", rel],
      { allowNonZeroExit: true },
    );
    untracked += r.stdout ?? "";
  }

  return tracked + untracked;
}

function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function mountDiffRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  checkpointStore: CheckpointStore,
): void {
  // GET /diff?worktreePath=<abs>&chatId=<id>
  //
  // One total diff for the workspace: the root repo plus every independent
  // nested repo beneath it. Each repo is diffed against its own fork point
  // (merge-base of the trunk and HEAD) so the result is branch/worktree-scoped
  // — every chat on the same checkout sees the same consolidated diff. One
  // section per repo, labelled by its path relative to the workspace root.
  // Empty-diff repos are omitted.
  //
  // ponytail: a worktree-mode root instead diffs against the chat-start
  // checkpoint (the chat's fork point), while /git/status intentionally stays
  // on trunk so its ahead/behind vs trunk stays meaningful — the minor label
  // divergence between the two panels is accepted.
  routes["/diff"] = async (_req, url) => {
    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    if (!worktreePath) {
      return jsonResponse({ error: "missing worktreePath" }, 400);
    }
    const chatId = url.searchParams.get("chatId");

    // Root-repo base override: for a worktree-mode chat, diff the root against
    // the chat-start checkpoint rather than the branch fork point. Nested repos
    // keep their own fork-point base.
    let rootBaseOverride: string | undefined;
    if (chatId && store.chats.get(chatId)?.worktree_mode === "worktree") {
      const startRef = await checkpointStore.resolveRef(chatId, "start", worktreePath);
      if (startRef) rootBaseOverride = startRef;
    }
    const rootCanonical = canonicalize(worktreePath);

    const repos = discoverRepos(worktreePath);
    const sections: DiffSection[] = [];
    for (const repo of repos) {
      const isRoot = canonicalize(repo) === rootCanonical;
      const diff = await repoDiff(repo, isRoot ? rootBaseOverride : undefined);
      if (diff.trim().length === 0) continue;
      const label = path.relative(worktreePath, repo);
      sections.push({ kind: "whole", label, diff });
    }

    return jsonResponse({ sections }, 200);
  };
}
