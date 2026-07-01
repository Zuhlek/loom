// POST /git/commit + POST /git/push — branch toolbar actions.
// POST /git/pr lives in source-control-rpc.ts (provider-routed).
//
// Per ADR-006 the push verb routes through the source-control provider
// when the configured `origin` matches a registered provider host
// (github / bitbucket). For non-matching remotes the request falls
// back to the generic `git push` path.
import { commitOnly } from "../git/workflow.ts";
import {
  push,
  currentBranch,
  getRemoteUrl as defaultGetRemoteUrl,
} from "../git/manager.ts";
import { getProvider as defaultGetProvider } from "../source-control/index.ts";
import { jsonResponse, methodNotAllowed } from "./_response.ts";
import { errorMessage, providerErrorResponse } from "./_route-helpers.ts";
import type { SourceControlProviderShape } from "../source-control/types.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export interface GitActionsRouteDeps {
  getProvider?: (remoteUrl: string) => SourceControlProviderShape | null;
  getRemoteUrl?: (cwd: string, remote?: string) => Promise<string | null>;
}

export function mountGitActionsRoute(
  routes: Record<string, Handler>,
  deps: GitActionsRouteDeps = {},
): void {
  const getProvider = deps.getProvider ?? defaultGetProvider;
  const getRemoteUrl = deps.getRemoteUrl ?? defaultGetRemoteUrl;

  routes["/git/commit"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
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
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    if (typeof body?.worktreePath !== "string" || body.worktreePath.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    const cwd: string = body.worktreePath;
    const setUpstream = body.setUpstream === true;
    const force = body.forceWithLease === true;

    // Provider-routed path: resolve origin URL, classify, dispatch to
    // provider.pushBranch when a registered provider matches.
    let remoteUrl: string | null = null;
    try {
      remoteUrl = await getRemoteUrl(cwd, "origin");
    } catch {
      remoteUrl = null;
    }
    const provider = remoteUrl ? getProvider(remoteUrl) : null;

    if (provider) {
      try {
        const branch = await currentBranch(cwd);
        if (!branch) {
          return jsonResponse({ error: "detached HEAD; cannot push" }, 400);
        }
        await provider.pushBranch({
          cwd,
          branch,
          remote: "origin",
          setUpstream,
        });
        return jsonResponse({ ok: true }, 200);
      } catch (e) {
        return providerErrorResponse(e);
      }
    }

    // Generic fallback — non-routed remote (e.g. gitlab.com) or no
    // origin configured at all.
    try {
      await push(cwd, {
        remote: "origin",
        setUpstream,
        force,
      });
      return jsonResponse({ ok: true }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

}
