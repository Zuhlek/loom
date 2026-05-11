/**
 * POST /cwd/validate-worktree — checks whether the cwd is a git repo
 * so the spawn dialog's worktree opt-in checkbox can guard non-git cwds.
 */
import { isGitRepo } from "../git/is-git-repo.ts";

export function mountCwdValidateRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/cwd/validate-worktree"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
    }
    const cwd = body?.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) {
      return new Response(JSON.stringify({ error: "missing cwd" }), { status: 400 });
    }
    const probe = isGitRepo(cwd);
    return new Response(
      JSON.stringify({
        isGit: probe.isGit,
        repoName: probe.repoName,
        topLevel: probe.topLevel,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
