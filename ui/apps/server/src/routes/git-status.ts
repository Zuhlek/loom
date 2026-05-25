/**
 * GET /git/status?worktreePath=<abs>&base=<ref>
 *
 * Returns { branch, base, ahead, behind, uncommitted, remote? } for a given
 * worktree. Composes existing git primitives — no new git plumbing. Default
 * base is "main". 400 on empty worktreePath; 500 on underlying git failure.
 */
import { executeGit } from "../git/worktree.ts";
import { currentBranch, getRemoteUrl, hasUncommittedChanges } from "../git/manager.ts";
import { jsonResponse } from "./_response.ts";

interface GitStatusResponse {
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  uncommitted: boolean;
  remote?: string;
}

export function mountGitStatusRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/git/status"] = async (_req, url) => {
    const worktreePath = url.searchParams.get("worktreePath") ?? "";
    const base = url.searchParams.get("base") ?? "main";
    if (!worktreePath) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    try {
      const branch = (await currentBranch(worktreePath)) ?? "";
      const uncommitted = await hasUncommittedChanges(worktreePath);
      const { stdout } = await executeGit(worktreePath, [
        "rev-list",
        "--left-right",
        "--count",
        `${base}...HEAD`,
      ]);
      const [behindStr, aheadStr] = stdout.trim().split(/\s+/);
      const behind = Number(behindStr) || 0;
      const ahead = Number(aheadStr) || 0;
      const remote = (await getRemoteUrl(worktreePath)) ?? undefined;
      const body: GitStatusResponse = { branch, base, ahead, behind, uncommitted };
      if (remote) body.remote = remote;
      return jsonResponse(body, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: message }, 500);
    }
  };
}
