/**
 * GET /file-search?cwd=...&q=...
 */
import { walkCwd, fuzzyRank } from "../fs/walk.ts";

export function mountFileSearchRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/file-search"] = async (req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const q = url.searchParams.get("q") ?? "";
    if (!cwd) return new Response(JSON.stringify({ error: "missing cwd" }), { status: 400 });
    const all = walkCwd(cwd);
    const ranked = fuzzyRank(q, all, 50);
    return new Response(JSON.stringify({ results: ranked }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
