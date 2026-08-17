import { executeGit } from "../git/worktree.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { CheckpointStore } from "../checkpointing/checkpoint-store.ts";

export interface FirstSendHookArgs {
  store: MetadataStore;
  chatId: string;
  checkpointStore: CheckpointStore;
}

export interface FirstSendHookResult {
  worktreeMode: "local" | "worktree";
  worktreePath: string | null;
  branch: string | null;
  checkpointRef: string | null;
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

// `worktree_mode` / `worktree_path` are committed at spawn time by
// `resolveAndPersistSpawnCwd` — the pane cwd must be final before the PTY
// starts, which is strictly earlier than the first send. This hook only
// records the branch and captures the turn-0 checkpoint.
export async function runFirstSendHook(args: FirstSendHookArgs): Promise<FirstSendHookResult> {
  const chat = args.store.chats.get(args.chatId);
  if (!chat) {
    throw new Error(`chat not found: ${args.chatId}`);
  }

  const cwd = chat.worktree_path ?? chat.cwd;
  let branch = chat.branch;
  if (branch === null) {
    branch = await readProjectHeadBranch(cwd);
    if (branch !== null) args.store.chats.update(args.chatId, { branch });
  }

  // Synthetic chat-start checkpoint. Capture-from-non-git-cwd returns
  // null silently — `vcs_kind === "unknown"` paths take that branch.
  const ck = await args.checkpointStore.captureTurn({
    chatId: args.chatId,
    cwd,
    turn: 0,
  });

  return {
    worktreeMode: chat.worktree_mode ?? "local",
    worktreePath: chat.worktree_path,
    branch,
    checkpointRef: ck?.ref ?? null,
  };
}
