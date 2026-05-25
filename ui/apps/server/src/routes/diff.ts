/**
 * GET /diff?worktreePath=...&base=...&mode=per-turn|whole
 *
 * Shells out to `git -C <worktreePath> diff <base> --unified=3` so that
 * the working-tree state (uncommitted edits the agent just made) is
 * included alongside any committed branch history. The earlier
 * `<base>...HEAD` range excluded the working tree entirely, which made
 * the panel render "No changes on this branch yet" whenever the agent
 * had edited but not committed — the common case since loom doesn't
 * auto-commit per turn (SR-33).
 *
 * For per-turn mode, each committed turn becomes its own section; any
 * remaining uncommitted delta is appended as a trailing "Uncommitted"
 * section so the user can see in-flight work without committing first.
 */
import { spawnSync } from "node:child_process";

import { jsonResponse } from "./_response.ts";

export interface DiffSection {
  kind: "per-turn" | "whole";
  label: string;
  diff: string;
}

export function mountDiffRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/diff"] = async (req, url) => {
    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    const base = url.searchParams.get("base") ?? "main";
    const mode = (url.searchParams.get("mode") ?? "whole") as "per-turn" | "whole";
    if (!worktreePath) {
      return jsonResponse({ error: "missing worktreePath" }, 400);
    }
    const sections: DiffSection[] = [];
    if (mode === "per-turn") {
      // List commits unique to HEAD vs base; one diff per commit.
      const log = spawnSync("git", ["-C", worktreePath, "log", `${base}..HEAD`, "--pretty=%H%x09%s"], {
        encoding: "utf8",
      });
      if (log.status === 0 && log.stdout.trim().length > 0) {
        const lines = log.stdout.trim().split("\n").reverse();
        for (const line of lines) {
          const [sha, ...subjectParts] = line.split("\t");
          const subject = subjectParts.join("\t");
          const d = spawnSync("git", ["-C", worktreePath, "show", sha, "--stat", "--unified=3"], {
            encoding: "utf8",
          });
          sections.push({ kind: "per-turn", label: subject, diff: d.stdout });
        }
        // Append any working-tree delta on top of the committed history.
        const uncommitted = spawnSync("git", ["-C", worktreePath, "diff", "HEAD", "--unified=3"], {
          encoding: "utf8",
        });
        if (uncommitted.status === 0 && uncommitted.stdout.trim().length > 0) {
          sections.push({ kind: "per-turn", label: "Uncommitted", diff: uncommitted.stdout });
        }
      }
    }
    if (sections.length === 0) {
      // `<base>` (no range) diffs base vs the working tree — committed
      // branch history + staged + unstaged. This is what the user wants
      // to see in the panel: "everything that would be in my PR if I
      // committed and pushed right now."
      const d = spawnSync("git", ["-C", worktreePath, "diff", base, "--unified=3"], {
        encoding: "utf8",
      });
      sections.push({ kind: "whole", label: `${base}…working tree`, diff: d.stdout || "" });
    }
    return jsonResponse({ sections }, 200);
  };
}
