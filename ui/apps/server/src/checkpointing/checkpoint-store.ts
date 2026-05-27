import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { executeGit, GitCommandError } from "../git/worktree.ts";

export interface CaptureTurnArgs {
  chatId: string;
  cwd: string;
  turn: number;
}

export interface CaptureTurnResult {
  ref: string;
  sha: string;
}

export interface CheckpointStore {
  captureTurn(args: CaptureTurnArgs): Promise<CaptureTurnResult | null>;
  resolveRef(chatId: string, turn: number | "start" | "latest", cwd: string): Promise<string | null>;
  listTurns(chatId: string, cwd: string): Promise<number[]>;
}

function refFor(chatId: string, turn: number): string {
  return `refs/loom-checkpoints/${chatId}/${turn}`;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const r = await executeGit(cwd, ["rev-parse", "--git-dir"], { allowNonZeroExit: true });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

async function resolveExistingRef(cwd: string, ref: string): Promise<string | null> {
  const r = await executeGit(cwd, ["show-ref", "--verify", "--hash", ref], {
    allowNonZeroExit: true,
  });
  if (r.exitCode !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

export function createCheckpointStore(): CheckpointStore {
  return {
    async captureTurn(args) {
      if (!(await isGitRepo(args.cwd))) return null;

      const targetRef = refFor(args.chatId, args.turn);

      // Idempotence: if the ref already exists, return its sha unchanged.
      const existing = await resolveExistingRef(args.cwd, targetRef);
      if (existing) return { ref: targetRef, sha: existing };

      // Stage the working tree into an isolated temp index so we don't
      // perturb the user's `.git/index` state.
      const indexFile = path.join(
        os.tmpdir(),
        `loom-checkpoint-index-${args.chatId}-${args.turn}-${process.pid}-${Date.now()}`,
      );
      try {
        const env = { GIT_INDEX_FILE: indexFile };

        // Seed the temp index from the current tree so `git add -A` over
        // it produces a diff base that includes tracked-but-unmodified
        // files. On an empty repo (no HEAD yet) the read-tree fails and
        // we fall through — `add -A` over the empty index seeds from the
        // working tree directly.
        await executeGit(args.cwd, ["read-tree", "HEAD"], { env }).catch(() => undefined);
        await executeGit(args.cwd, ["add", "-A"], { env });
        const treeRes = await executeGit(args.cwd, ["write-tree"], { env });
        const tree = treeRes.stdout.trim();

        const parentRef = args.turn > 0 ? refFor(args.chatId, args.turn - 1) : null;
        const parentSha = parentRef ? await resolveExistingRef(args.cwd, parentRef) : null;

        const commitArgs = ["commit-tree", tree, "-m", `loom checkpoint ${args.turn}`];
        if (parentSha) commitArgs.push("-p", parentSha);
        const commitRes = await executeGit(args.cwd, commitArgs);
        const commitSha = commitRes.stdout.trim();

        await executeGit(args.cwd, ["update-ref", targetRef, commitSha]);
        return { ref: targetRef, sha: commitSha };
      } finally {
        try {
          fs.unlinkSync(indexFile);
        } catch {
          /* index file may not have been written; harmless */
        }
      }
    },

    async resolveRef(chatId, turn, cwd) {
      if (!(await isGitRepo(cwd))) return null;
      if (turn === "start") {
        const ref = refFor(chatId, 0);
        const sha = await resolveExistingRef(cwd, ref);
        return sha ? ref : null;
      }
      if (turn === "latest") {
        const turns = await this.listTurns(chatId, cwd);
        if (turns.length === 0) return null;
        return refFor(chatId, turns[turns.length - 1]!);
      }
      const ref = refFor(chatId, turn);
      const sha = await resolveExistingRef(cwd, ref);
      return sha ? ref : null;
    },

    async listTurns(chatId, cwd) {
      if (!(await isGitRepo(cwd))) return [];
      const r = await executeGit(
        cwd,
        ["for-each-ref", "--format=%(refname)", `refs/loom-checkpoints/${chatId}/`],
        { allowNonZeroExit: true },
      );
      if (r.exitCode !== 0) return [];
      const prefix = `refs/loom-checkpoints/${chatId}/`;
      const turns: number[] = [];
      for (const line of r.stdout.split("\n")) {
        const ref = line.trim();
        if (!ref.startsWith(prefix)) continue;
        const tail = ref.slice(prefix.length);
        const n = Number(tail);
        if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) turns.push(n);
      }
      turns.sort((a, b) => a - b);
      return turns;
    },
  };
}

export { GitCommandError };
