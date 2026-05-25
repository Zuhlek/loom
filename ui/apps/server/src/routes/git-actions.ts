/**
 * POST /git/commit, POST /git/push, POST /git/pr — branch toolbar actions.
 *
 * Wraps `git/workflow.ts` (commitOnly, createPullRequest) and `git/manager.ts`
 * (push). Loopback-trust model — no auth, inherited from /diff. spawn calls
 * live inside the wrapped modules and use argv arrays only.
 */
import { commitOnly, createPullRequest } from "../git/workflow.ts";
import { push } from "../git/manager.ts";
import { jsonResponse } from "./_response.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function mountGitActionsRoute(routes: Record<string, Handler>): void {
  routes["/git/commit"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    if (typeof body?.worktreePath !== "string" || body.worktreePath.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    if (typeof body?.message !== "string" || body.message.length === 0) {
      return jsonResponse({ error: "message required" }, 400);
    }
    const fullMessage = typeof body.body === "string" && body.body.length > 0
      ? `${body.message}\n\n${body.body}`
      : body.message;
    try {
      const result = await commitOnly({ cwd: body.worktreePath, message: fullMessage });
      return jsonResponse({ sha: result.sha }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

  routes["/git/push"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    if (typeof body?.worktreePath !== "string" || body.worktreePath.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    try {
      await push(body.worktreePath, {
        remote: "origin",
        setUpstream: body.setUpstream === true,
        force: body.forceWithLease === true,
      });
      return jsonResponse({ ok: true }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

  routes["/git/pr"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    if (typeof body?.worktreePath !== "string" || body.worktreePath.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    if (typeof body?.title !== "string" || body.title.length === 0) {
      return jsonResponse({ error: "title required" }, 400);
    }
    try {
      const pr = await createPullRequest({
        cwd: body.worktreePath,
        message: body.title,
        title: body.title,
        body: typeof body.body === "string" ? body.body : undefined,
      });
      return jsonResponse({ url: pr.url }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };
}
