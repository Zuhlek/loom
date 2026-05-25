/**
 * POST /cwd/validate-worktree — checks whether the cwd is a git repo
 * so the spawn dialog's worktree opt-in checkbox can guard non-git cwds.
 */
import { isGitRepo } from "../git/is-git-repo.ts";
import { jsonResponse } from "./_response.ts";

export function mountCwdValidateRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/cwd/validate-worktree"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const cwd = body?.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) {
      return jsonResponse({ error: "missing cwd" }, 400);
    }
    const probe = isGitRepo(cwd);
    return jsonResponse(
      {
        isGit: probe.isGit,
        repoName: probe.repoName,
        topLevel: probe.topLevel,
      },
      200,
    );
  };
}
