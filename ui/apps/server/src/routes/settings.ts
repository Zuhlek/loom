/**
 * GET /settings — Workspace + Worktrees + Auth panels payload.
 */
import type { ResolvedConfig } from "../config-loader/index.ts";
import { getClaudeLoginStatus } from "../auth/claude-login-status.ts";

export function mountSettingsRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  config: ResolvedConfig,
): void {
  routes["/settings"] = async () => {
    const auth = getClaudeLoginStatus();
    return new Response(
      JSON.stringify({
        workspace: {
          root: config.root,
          source: config.source,
          defaultEnvMode: config.defaultEnvMode,
        },
        worktrees: { root: config.worktreesRoot ?? null },
        auth,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
