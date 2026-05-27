import { spawnSync } from "node:child_process";

import { jsonResponse } from "./_response.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { CheckpointDiffQuery } from "../checkpointing/checkpoint-diff-query.ts";
import type { CheckpointStore } from "../checkpointing/checkpoint-store.ts";

export interface DiffSection {
  kind: "per-turn" | "whole" | "checkpoint-range";
  label: string;
  diff: string;
}

export interface DiffRouteDeps {
  store?: MetadataStore;
  diffQuery?: CheckpointDiffQuery;
  checkpointStore?: CheckpointStore;
}

function parseTurnArg(raw: string | null, kind: "from" | "to"): number | "start" | "latest" | null {
  if (raw === null) return null;
  if (kind === "from" && raw === "start") return "start";
  if (kind === "to" && raw === "latest") return "latest";
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function mountDiffRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  deps: DiffRouteDeps = {},
): void {
  routes["/checkpoints/list"] = async (_req, url) => {
    const chatId = url.searchParams.get("chatId");
    if (!chatId) return jsonResponse({ error: "missing chatId" }, 400);
    if (!deps.store || !deps.checkpointStore) {
      return jsonResponse({ error: "checkpoint listing not configured" }, 500);
    }
    const chat = deps.store.chats.get(chatId);
    if (!chat) return jsonResponse({ error: "chat not found" }, 404);
    const cwd = chat.worktree_path ?? chat.cwd;
    const turns = await deps.checkpointStore.listTurns(chatId, cwd);
    return jsonResponse({ turns }, 200);
  };

  routes["/diff"] = async (req, url) => {
    const mode = (url.searchParams.get("mode") ?? "whole") as
      | "per-turn"
      | "whole"
      | "checkpoint-range";

    if (mode === "checkpoint-range") {
      const chatId = url.searchParams.get("chatId");
      if (!chatId) {
        return jsonResponse({ error: "missing chatId" }, 400);
      }
      if (!deps.store || !deps.diffQuery) {
        return jsonResponse({ error: "checkpoint-range mode not configured" }, 500);
      }
      const chat = deps.store.chats.get(chatId);
      if (!chat) {
        return jsonResponse({ error: "chat not found" }, 404);
      }
      const from = parseTurnArg(url.searchParams.get("from"), "from");
      const to = parseTurnArg(url.searchParams.get("to"), "to");
      if (from === null || to === null) {
        return jsonResponse({ error: "invalid from/to" }, 400);
      }
      const cwd = chat.worktree_path ?? chat.cwd;
      const r = await deps.diffQuery.getTurnDiff({ chatId, cwd, from, to });
      return jsonResponse({ sections: r.sections }, 200);
    }

    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    const base = url.searchParams.get("base") ?? "main";
    if (!worktreePath) {
      return jsonResponse({ error: "missing worktreePath" }, 400);
    }
    const sections: DiffSection[] = [];
    if (mode === "per-turn") {
      const log = spawnSync(
        "git",
        ["-C", worktreePath, "log", `${base}..HEAD`, "--pretty=%H%x09%s"],
        { encoding: "utf8" },
      );
      if (log.status === 0 && log.stdout.trim().length > 0) {
        const lines = log.stdout.trim().split("\n").reverse();
        for (const line of lines) {
          const [sha, ...subjectParts] = line.split("\t");
          const subject = subjectParts.join("\t");
          const d = spawnSync(
            "git",
            ["-C", worktreePath, "show", sha, "--stat", "--unified=3"],
            { encoding: "utf8" },
          );
          sections.push({ kind: "per-turn", label: subject, diff: d.stdout });
        }
        const uncommitted = spawnSync(
          "git",
          ["-C", worktreePath, "diff", "HEAD", "--unified=3"],
          { encoding: "utf8" },
        );
        if (uncommitted.status === 0 && uncommitted.stdout.trim().length > 0) {
          sections.push({ kind: "per-turn", label: "Uncommitted", diff: uncommitted.stdout });
        }
      }
    }
    if (sections.length === 0) {
      const d = spawnSync("git", ["-C", worktreePath, "diff", base, "--unified=3"], {
        encoding: "utf8",
      });
      sections.push({ kind: "whole", label: `${base}…working tree`, diff: d.stdout || "" });
    }
    return jsonResponse({ sections }, 200);
  };
}
