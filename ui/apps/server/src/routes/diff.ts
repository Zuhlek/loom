/**
 * GET /diff?worktreePath=...&base=...&mode=per-turn|whole
 *
 * Shells out to `git -C <worktreePath> diff <base>...HEAD --unified=3`.
 * For per-turn mode, returns each turn's commits' diffs as separate
 * sections. nora doesn't auto-commit-per-turn (SR-33), so per-turn
 * is best-effort; it falls back to whole-conversation if no commits
 * exist.
 */
import { spawnSync } from "node:child_process";

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
      return new Response(JSON.stringify({ error: "missing worktreePath" }), { status: 400 });
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
      }
    }
    if (sections.length === 0) {
      const d = spawnSync("git", ["-C", worktreePath, "diff", `${base}...HEAD`, "--unified=3"], {
        encoding: "utf8",
      });
      sections.push({ kind: "whole", label: `${base}...HEAD`, diff: d.stdout || "" });
    }
    return new Response(JSON.stringify({ sections }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
