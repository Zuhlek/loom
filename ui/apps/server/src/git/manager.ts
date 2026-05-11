/*
 * GitManager — high-level operations on a worktree (commit, push, branch ops).
 *
 * Lifted from t3code's apps/server/src/git/GitManager.ts (MIT License). The
 * Effect runtime is replaced with plain async/await; only the operations we
 * need for nora's "Commit / Commit & push / Create PR" branch toolbar are
 * implemented.
 */

import { executeGit, GitCommandError } from "./worktree";

export interface CommitOptions {
  message: string;
  /** When true, run `git add -A` before committing (capturing all changes). */
  stageAll?: boolean;
  /** Optional list of paths to stage (overrides stageAll). */
  stagePaths?: string[];
  /** Allow empty commits? Default false. */
  allowEmpty?: boolean;
}

export interface CommitResult {
  sha: string;
  shortSha: string;
}

/** Stage changes and commit them in `cwd`. */
export async function commit(cwd: string, opts: CommitOptions): Promise<CommitResult> {
  if (opts.stagePaths && opts.stagePaths.length > 0) {
    await executeGit(cwd, ["add", "--", ...opts.stagePaths]);
  } else if (opts.stageAll !== false) {
    await executeGit(cwd, ["add", "-A"]);
  }
  const args = ["commit", "-m", opts.message];
  if (opts.allowEmpty) args.push("--allow-empty");
  await executeGit(cwd, args);
  const { stdout: full } = await executeGit(cwd, ["rev-parse", "HEAD"]);
  const { stdout: short } = await executeGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return { sha: full.trim(), shortSha: short.trim() };
}

export interface PushOptions {
  /** Remote name. Defaults to "origin". */
  remote?: string;
  /** Branch to push. Defaults to current branch. */
  branch?: string;
  /** Set upstream tracking on push? Default true on first push. */
  setUpstream?: boolean;
  /** Force push? Disabled by default. */
  force?: boolean;
}

/** `git push` with safe defaults. */
export async function push(cwd: string, opts: PushOptions = {}): Promise<void> {
  const remote = opts.remote ?? "origin";
  const args: string[] = ["push"];
  if (opts.setUpstream !== false) args.push("-u");
  if (opts.force) args.push("--force-with-lease");
  args.push(remote);
  if (opts.branch) args.push(opts.branch);
  await executeGit(cwd, args, { timeoutMs: 60_000 });
}

/** Resolve the configured remote URL for `remote`, or null if unset. */
export async function getRemoteUrl(cwd: string, remote = "origin"): Promise<string | null> {
  try {
    const { stdout } = await executeGit(cwd, ["remote", "get-url", remote]);
    return stdout.trim() || null;
  } catch (e) {
    if (e instanceof GitCommandError) return null;
    throw e;
  }
}

/** Current branch name, or null if detached HEAD. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await executeGit(cwd, ["symbolic-ref", "--short", "HEAD"]);
    const v = stdout.trim();
    return v || null;
  } catch {
    return null;
  }
}

/** True if the working tree has uncommitted changes (staged or unstaged). */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { stdout } = await executeGit(cwd, ["status", "--porcelain"]);
  return stdout.trim().length > 0;
}
