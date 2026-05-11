/**
 * GET /config — returns resolved root + source label.
 */
import type { ResolvedConfig } from "../config-loader/index.ts";

export function mountConfigRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  config: ResolvedConfig,
): void {
  routes["/config"] = () =>
    new Response(
      JSON.stringify({
        root: config.root,
        source: config.source,
        worktreesRoot: config.worktreesRoot ?? null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}
