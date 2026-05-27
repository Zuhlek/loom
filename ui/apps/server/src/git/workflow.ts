/*
 * GitWorkflowService — the "Commit / Commit & push / Create PR" composite ops.
 *
 * Lifted from t3code's apps/server/src/git/GitWorkflowService.ts (MIT License),
 * simplified for loom. Each method is one button on the worktree-mode chat's
 * branch toolbar (mockup 05).
 */

import { commit, push, getRemoteUrl, currentBranch, hasUncommittedChanges } from "./manager";
import { getProvider, type SourceControlProviderShape } from "../source-control";

export interface CommitArgs {
  cwd: string;
  message: string;
}

export interface CommitAndPushArgs extends CommitArgs {
  remote?: string;
}

export interface CreatePrArgs extends CommitAndPushArgs {
  /** PR title; defaults to first line of commit message. */
  title?: string;
  /** PR body; optional. */
  body?: string;
  /** Base branch (PR target). Defaults to "main". */
  baseBranch?: string;
}

export interface PrResult {
  url: string;
  number?: number;
  provider: string;
}

/** Run `git commit` in cwd with the supplied message. */
export async function commitOnly(args: CommitArgs) {
  const sha = await commit(args.cwd, { message: args.message, stageAll: true });
  return { kind: "commit" as const, ...sha };
}

/** Commit then push (`git push -u origin <branch>`). */
export async function commitAndPush(args: CommitAndPushArgs) {
  const dirty = await hasUncommittedChanges(args.cwd);
  if (dirty) {
    await commit(args.cwd, { message: args.message, stageAll: true });
  }
  await push(args.cwd, { remote: args.remote ?? "origin" });
  return { kind: "commit-and-push" as const };
}

/** Commit, push, then open a PR via the matching SCM provider. */
export async function createPullRequest(args: CreatePrArgs): Promise<PrResult> {
  const dirty = await hasUncommittedChanges(args.cwd);
  if (dirty) {
    await commit(args.cwd, { message: args.message, stageAll: true });
  }
  await push(args.cwd, { remote: args.remote ?? "origin" });
  const branch = await currentBranch(args.cwd);
  if (!branch) {
    throw new Error("Cannot create PR from a detached HEAD; check out a branch first.");
  }
  const remoteUrl = await getRemoteUrl(args.cwd, args.remote ?? "origin");
  if (!remoteUrl) {
    throw new Error(`No remote URL configured for "${args.remote ?? "origin"}".`);
  }
  const provider: SourceControlProviderShape | null = getProvider(remoteUrl);
  if (!provider) {
    throw new Error(`No source-control provider matches remote URL: ${remoteUrl}`);
  }
  const pr = await provider.createPr({
    cwd: args.cwd,
    remoteUrl,
    head: branch,
    base: args.baseBranch ?? "main",
    title: args.title ?? args.message.split("\n")[0]!,
    body: args.body,
  });
  return { ...pr, provider: provider.kind };
}
