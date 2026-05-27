import { executeGit } from "../git/worktree.ts";
import type { CheckpointStore } from "./checkpoint-store.ts";

export interface DiffSection {
  kind: "checkpoint-range";
  label: string;
  diff: string;
}

export interface GetTurnDiffArgs {
  chatId: string;
  cwd: string;
  from: number | "start";
  to: number | "latest";
}

export interface CheckpointDiffQuery {
  getTurnDiff(args: GetTurnDiffArgs): Promise<{ sections: DiffSection[] }>;
}

export function createCheckpointDiffQuery(store: CheckpointStore): CheckpointDiffQuery {
  return {
    async getTurnDiff(args) {
      const fromTurn = args.from === "start" ? 0 : args.from;
      const fromRef = await store.resolveRef(args.chatId, fromTurn, args.cwd);
      const toRef = await store.resolveRef(args.chatId, args.to, args.cwd);
      if (!fromRef || !toRef) return { sections: [] };
      try {
        const r = await executeGit(args.cwd, [
          "diff",
          `${fromRef}..${toRef}`,
          "--unified=3",
        ]);
        const diff = r.stdout;
        if (!diff || diff.trim().length === 0) return { sections: [] };
        return {
          sections: [
            {
              kind: "checkpoint-range",
              label: `${fromRef}..${toRef}`,
              diff,
            },
          ],
        };
      } catch {
        return { sections: [] };
      }
    },
  };
}
