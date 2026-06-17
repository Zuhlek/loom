/**
 * GET /git/status?worktreePath=<abs>&base=<ref>
 *
 * Returns { branch, base, ahead, behind, uncommitted, remote? } for a given
 * worktree. Composes existing git primitives — no new git plumbing. `base`
 * defaults to the repo's resolved trunk (origin/HEAD → main/master). 400 on
 * empty worktreePath; 500 on underlying git failure.
 */
import { executeGit } from "../git/worktree.ts";
import { currentBranch, getRemoteUrl, hasUncommittedChanges } from "../git/manager.ts";
import { jsonResponse } from "./_response.ts";
import { getProjectDefaultBranch } from "./_route-helpers.ts";

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
    if (!worktreePath) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    // Resolve the trunk the same way `/diff` does, so the toolbar's base label
    // and ahead/behind counts line up with the diff. An explicit `base` query
    // param overrides.
    const base =
      url.searchParams.get("base") ?? (await getProjectDefaultBranch(worktreePath));
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
