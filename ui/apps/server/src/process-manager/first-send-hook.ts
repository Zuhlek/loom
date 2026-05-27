import * as crypto from "node:crypto";
import * as path from "node:path";
import { createWorktree as defaultCreateWorktree, executeGit } from "../git/worktree.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { CheckpointStore } from "../checkpointing/checkpoint-store.ts";

export interface FirstSendHookArgs {
  store: MetadataStore;
  chatId: string;
  defaultEnvMode: "local" | "worktree";
  checkpointStore: CheckpointStore;
  /** Test seam: swap `git/worktree.createWorktree` for a fake. */
  createWorktreeImpl?: typeof defaultCreateWorktree;
}

export interface FirstSendHookResult {
  worktreeMode: "local" | "worktree";
  worktreePath: string | null;
  branch: string | null;
  checkpointRef: string | null;
  alreadyCommitted: boolean;
}

async function readProjectHeadBranch(cwd: string): Promise<string | null> {
  try {
    const r = await executeGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], {
      allowNonZeroExit: true,
    });
    if (r.exitCode !== 0) return null;
    const branch = r.stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

export async function runFirstSendHook(args: FirstSendHookArgs): Promise<FirstSendHookResult> {
  const chat = args.store.chats.get(args.chatId);
  if (!chat) {
    throw new Error(`chat not found: ${args.chatId}`);
  }
  // The row's `worktree_mode` is `null` until this hook commits it.
  // Once present ("local" or "worktree"), the hook short-circuits.
  const raw = chat.worktree_mode;
  const alreadyCommitted = raw === "local" || raw === "worktree";
  if (alreadyCommitted) {
    return {
      worktreeMode: raw,
      worktreePath: chat.worktree_path,
      branch: chat.branch,
      checkpointRef: null,
      alreadyCommitted: true,
    };
  }

  const createWorktreeImpl = args.createWorktreeImpl ?? defaultCreateWorktree;

  let mode: "local" | "worktree" = args.defaultEnvMode;
  let worktreePath: string | null = null;
  let branch: string | null = null;

  if (mode === "worktree") {
    const newBranch = `loom/${args.chatId}`;
    const sha8 = crypto.createHash("sha1").update(`${args.chatId}:${newBranch}`).digest("hex").slice(0, 8);
    const target = path.resolve(chat.cwd, ".loom-worktrees", args.chatId, sha8);
    try {
      worktreePath = await createWorktreeImpl({
        parentCwd: chat.cwd,
        worktreePath: target,
        newBranch,
      });
      branch = newBranch;
    } catch (err) {
      console.warn(
        `[loom] first-send worktree creation failed for ${args.chatId}; falling back to local: ${(err as Error).message}`,
      );
      mode = "local";
      worktreePath = null;
    }
  }
  if (mode === "local") {
    branch = await readProjectHeadBranch(chat.cwd);
  }

  args.store.chats.update(args.chatId, {
    worktree_mode: mode,
    worktree_path: worktreePath,
    branch,
  });

  // Synthetic chat-start checkpoint. Capture-from-non-git-cwd returns
  // null silently — `vcs_kind === "unknown"` paths take that branch.
  const captureCwd = worktreePath ?? chat.cwd;
  const ck = await args.checkpointStore.captureTurn({
    chatId: args.chatId,
    cwd: captureCwd,
    turn: 0,
  });

  return {
    worktreeMode: mode,
    worktreePath,
    branch,
    checkpointRef: ck?.ref ?? null,
    alreadyCommitted: false,
  };
}
