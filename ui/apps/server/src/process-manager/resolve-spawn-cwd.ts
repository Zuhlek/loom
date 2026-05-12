/**
 * Resolve the cwd that the bridge should spawn the PTY in, given the
 * chat's worktree_mode. When worktree_mode === "worktree" and the cwd
 * is a git repo, materialise a worktree under `<worktreesRoot>/<chat
 * id>/<sha8>` and use that as the cwd. On any failure (not a repo,
 * createWorktree throws), fall back to the bare cwd and surface a
 * `fallbackReason` the bridge translates into a one-shot timeline
 * notice. The helper never throws — failures route to fallbackReason.
 *
 * See ADR-002 (worktree wiring lives at bridge spawn-time) and
 * ADR-006 (fallback emits a chat-timeline notice).
 */
import * as crypto from "node:crypto";
import * as path from "node:path";
import type { GitProbeResult } from "../git/is-git-repo.ts";
import type { CreateWorktreeOpts } from "../git/worktree.ts";
import { sanitizeBranchSegment } from "../git/worktree.ts";

export interface SpawnInputChat {
  id: string;
  cwd: string;
  worktree_mode: "local" | "worktree";
}

export interface SpawnInputConfig {
  worktreesRoot: string | null;
}

export interface SpawnInput {
  chat: SpawnInputChat;
  config: SpawnInputConfig;
}

export interface ResolveSpawnCwdDeps {
  isGitRepo(p: string): GitProbeResult;
  createWorktree(opts: CreateWorktreeOpts): Promise<string>;
}

export interface ResolvedSpawnCwd {
  cwd: string;
  worktreePath: string | null;
  fallbackReason: null | "not-a-repo" | "create-failed";
  fallbackDetail?: string;
}

function chatShortSha(chatId: string): string {
  return crypto.createHash("sha1").update(chatId).digest("hex").slice(0, 8);
}

export async function resolveSpawnCwd(
  input: SpawnInput,
  deps: ResolveSpawnCwdDeps,
): Promise<ResolvedSpawnCwd> {
  const { chat, config } = input;

  if (chat.worktree_mode === "local") {
    return { cwd: chat.cwd, worktreePath: null, fallbackReason: null };
  }

  const probe = deps.isGitRepo(chat.cwd);
  if (!probe.isGit) {
    return {
      cwd: chat.cwd,
      worktreePath: null,
      fallbackReason: "not-a-repo",
      fallbackDetail: `Worktree-mode requested but ${chat.cwd} is not a git repository — running in the bare cwd instead.`,
    };
  }

  const topLevel = probe.topLevel ?? chat.cwd;
  const root = config.worktreesRoot ?? path.join(topLevel, ".loom-worktrees");
  const chatName = sanitizeBranchSegment(chat.id);
  const sha8 = chatShortSha(chat.id);
  const worktreePath = path.join(root, chatName, sha8);
  const newBranch = `loom/${chatName}`;

  try {
    const created = await deps.createWorktree({
      parentCwd: topLevel,
      worktreePath,
      newBranch,
    });
    return { cwd: created, worktreePath: created, fallbackReason: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      cwd: chat.cwd,
      worktreePath: null,
      fallbackReason: "create-failed",
      fallbackDetail: detail.slice(0, 400),
    };
  }
}
