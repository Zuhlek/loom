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
import * as fs from "node:fs";
import * as path from "node:path";
import type { GitProbeResult } from "../git/is-git-repo.ts";
import { isGitRepo as defaultIsGitRepo } from "../git/is-git-repo.ts";
import type { CreateWorktreeOpts } from "../git/worktree.ts";
import { createWorktree as defaultCreateWorktree, sanitizeBranchSegment } from "../git/worktree.ts";
import type { MetadataStore } from "../metadata-store/index.ts";

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
  /** Branch the worktree was put on; `null` in local mode / on fallback. */
  branch: string | null;
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
    return { cwd: chat.cwd, worktreePath: null, branch: null, fallbackReason: null };
  }

  const probe = deps.isGitRepo(chat.cwd);
  if (!probe.isGit) {
    return {
      cwd: chat.cwd,
      worktreePath: null,
      branch: null,
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
    return { cwd: created, worktreePath: created, branch: newBranch, fallbackReason: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      cwd: chat.cwd,
      worktreePath: null,
      branch: null,
      fallbackReason: "create-failed",
      fallbackDetail: detail.slice(0, 400),
    };
  }
}

export interface SpawnCwdConfig {
  worktreesRoot?: string | null;
  defaultEnvMode: "local" | "worktree";
}

const productionDeps: ResolveSpawnCwdDeps = {
  isGitRepo: defaultIsGitRepo,
  createWorktree: defaultCreateWorktree,
};

/**
 * Production entry point, wired as the bridge's `cwdResolver` — the ONE
 * place a chat's `worktree_mode` becomes a real directory. It runs before
 * the PTY spawns, which is the only moment the cwd can still be chosen:
 * tmux pins `-c <cwd>` for the life of the pane and `SessionIdStore`
 * pins it for the life of the chat.
 *
 * Also the place the mode itself is committed — `null` means "use the
 * configured default", and once resolved the row carries the answer so
 * every later reader (diff panel, checkpoints, sidebar) agrees with the
 * directory the agent actually runs in.
 *
 * Never throws: a failed worktree falls back to the bare cwd and the row
 * is committed as `local`, so the chat is honest about where it lives.
 */
export async function resolveAndPersistSpawnCwd(
  store: MetadataStore,
  config: SpawnCwdConfig,
  chatId: string,
  deps: ResolveSpawnCwdDeps = productionDeps,
): Promise<string> {
  const chat = store.chats.get(chatId);
  if (!chat) return process.cwd();

  const mode = chat.worktree_mode ?? config.defaultEnvMode;
  // Already materialised: reuse it. Re-running createWorktree on every
  // respawn buys nothing, and a transient git failure would drop a live
  // chat back into the parent repo behind the user's back.
  if (mode === "worktree" && chat.worktree_path && fs.existsSync(chat.worktree_path)) {
    return chat.worktree_path;
  }

  const resolved = await resolveSpawnCwd(
    {
      chat: { id: chat.id, cwd: chat.cwd, worktree_mode: mode },
      config: { worktreesRoot: config.worktreesRoot ?? null },
    },
    deps,
  );

  if (resolved.fallbackReason) {
    console.warn(
      `[loom] worktree mode requested for ${chatId} but unavailable (${resolved.fallbackReason}): ${resolved.fallbackDetail ?? ""}`,
    );
  }

  store.chats.update(chatId, {
    worktree_mode: resolved.worktreePath ? "worktree" : "local",
    worktree_path: resolved.worktreePath,
    ...(resolved.branch ? { branch: resolved.branch } : {}),
  });

  return resolved.cwd;
}
