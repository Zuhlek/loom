/*
 * Worktree manager for nora.
 *
 * Lifted-and-adapted from t3code's apps/server/src/vcs/GitVcsDriverCore.ts
 * (MIT License, copyright t3tools authors). The Effect-runtime layer has been
 * stripped; we use plain async/await over Bun.spawn for v1.
 *
 * Original: https://github.com/t3tools/t3code  (apps/server/src/vcs/GitVcsDriverCore.ts)
 *
 * Responsibilities:
 *   - Run `git` commands in a given cwd, with timeout and output cap.
 *   - Create / list / remove worktrees off a parent repo.
 *   - Compute working-tree status (ahead/behind, dirty files).
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly args: readonly string[],
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

export interface ExecuteGitOptions {
  stdin?: string;
  timeoutMs?: number;
  allowNonZeroExit?: boolean;
  maxOutputBytes?: number;
}

export interface ExecuteGitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Run a `git` command in cwd, returning stdout/stderr/exit. */
export function executeGit(
  cwd: string,
  args: readonly string[],
  options: ExecuteGitOptions = {},
): Promise<ExecuteGitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args.slice(), {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let bytesRead = 0;
    const onData = (sink: Buffer[]) => (data: Buffer) => {
      bytesRead += data.byteLength;
      if (bytesRead <= maxBytes) sink.push(data);
    };
    proc.stdout?.on("data", onData(chunks));
    proc.stderr?.on("data", onData(errChunks));
    if (options.stdin) {
      proc.stdin?.write(options.stdin);
      proc.stdin?.end();
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new GitCommandError(`git ${args.join(" ")} timed out after ${timeoutMs}ms`, null, "", args));
    }, timeoutMs);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(new GitCommandError(`git ${args.join(" ")} failed: ${e.message}`, null, "", args));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString("utf8");
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (code === 0 || options.allowNonZeroExit) {
        resolve({ stdout, stderr, exitCode: code });
      } else {
        reject(new GitCommandError(`git ${args.join(" ")} exited ${code}: ${stderr}`, code, stderr, args));
      }
    });
  });
}

export interface WorktreeInfo {
  /** Filesystem path to the worktree root. */
  path: string;
  /** HEAD commit SHA, or null for detached/uninitialized. */
  head: string | null;
  /** Branch name (with refs/heads/ prefix), or null when detached. */
  branch: string | null;
  /** Whether this is the parent repo (`bare` is rare; we ignore it). */
  isMain?: boolean;
}

const WT_LINE = /^worktree (.+)$/;

/** `git worktree list --porcelain`, returning structured rows. */
export async function listWorktrees(parentCwd: string): Promise<WorktreeInfo[]> {
  const { stdout } = await executeGit(parentCwd, ["worktree", "list", "--porcelain"]);
  const blocks = stdout.split("\n\n").filter((b) => b.trim());
  const out: WorktreeInfo[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let p = "";
    let head: string | null = null;
    let branch: string | null = null;
    for (const line of lines) {
      const m = line.match(WT_LINE);
      if (m) p = m[1]!;
      else if (line.startsWith("HEAD ")) head = line.slice(5);
      else if (line.startsWith("branch ")) branch = line.slice(7);
    }
    if (p) out.push({ path: p, head, branch });
  }
  if (out.length > 0) out[0]!.isMain = true;
  return out;
}

export interface CreateWorktreeOpts {
  /** Path of the parent (main) repo. */
  parentCwd: string;
  /** Where the worktree should live, e.g. `~/.nora/worktrees/<repo>/<branch>`. */
  worktreePath: string;
  /** New branch name to create off of base. */
  newBranch: string;
  /** Branch to fork from. Defaults to current HEAD of the parent. */
  base?: string;
}

/** Create a new git worktree with a fresh branch. Returns the worktree path. */
export async function createWorktree(opts: CreateWorktreeOpts): Promise<string> {
  fs.mkdirSync(path.dirname(opts.worktreePath), { recursive: true });
  const args = ["worktree", "add", "-b", opts.newBranch, opts.worktreePath];
  if (opts.base) args.push(opts.base);
  await executeGit(opts.parentCwd, args);
  return opts.worktreePath;
}

/** Remove a worktree (force, since nora-managed worktrees are disposable). */
export async function removeWorktree(parentCwd: string, worktreePath: string): Promise<void> {
  await executeGit(parentCwd, ["worktree", "remove", "--force", worktreePath]);
}

export interface GitStatusDetails {
  isRepo: boolean;
  branch: string | null;
  upstreamRef: string | null;
  hasWorkingTreeChanges: boolean;
  /** Files with unstaged changes. */
  changedFiles: string[];
  ahead: number;
  behind: number;
}

const NON_REPO_STATUS: GitStatusDetails = {
  isRepo: false,
  branch: null,
  upstreamRef: null,
  hasWorkingTreeChanges: false,
  changedFiles: [],
  ahead: 0,
  behind: 0,
};

/** Get git status (porcelain v2) for a worktree. */
export async function getStatus(cwd: string): Promise<GitStatusDetails> {
  try {
    const { stdout } = await executeGit(cwd, ["status", "--porcelain=v2", "--branch", "--ahead-behind"]);
    const lines = stdout.split("\n");
    let branch: string | null = null;
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    const files: string[] = [];
    for (const raw of lines) {
      if (raw.startsWith("# branch.head ")) branch = raw.slice("# branch.head ".length);
      else if (raw.startsWith("# branch.upstream ")) upstream = raw.slice("# branch.upstream ".length);
      else if (raw.startsWith("# branch.ab ")) {
        const m = raw.match(/^# branch\.ab \+(\d+) -(\d+)$/);
        if (m) {
          ahead = Number(m[1]);
          behind = Number(m[2]);
        }
      } else if (raw && !raw.startsWith("#")) {
        // porcelain v2 entry: "1 ...path" or "2 ...path" or "? path"
        const parts = raw.split(" ");
        const last = parts[parts.length - 1];
        if (last) files.push(last);
      }
    }
    return {
      isRepo: true,
      branch,
      upstreamRef: upstream,
      hasWorkingTreeChanges: files.length > 0,
      changedFiles: files,
      ahead,
      behind,
    };
  } catch (e) {
    if (e instanceof GitCommandError && /not a git repository/i.test(e.stderr)) {
      return NON_REPO_STATUS;
    }
    throw e;
  }
}

/** Sanitize a string for use as a git branch ref segment. */
export function sanitizeBranchSegment(input: string): string {
  return input
    .replace(/[\s~^:?*\[\]\\]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
}
