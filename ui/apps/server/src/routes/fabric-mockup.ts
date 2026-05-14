/**
 * GET /fabric/mockup/list?cwd=...&project=...
 *      → returns list of *.html files
 * GET /fabric/mockup/file?cwd=...&project=...&file=...
 *      → returns the HTML body (Content-Security-Policy + sandboxed)
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function mountFabricMockupRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/fabric/mockup/list"] = async (req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const project = url.searchParams.get("project") ?? "";
    if (!cwd || !project) return new Response(JSON.stringify({ error: "missing cwd or project" }), { status: 400 });
    const dir = path.join(cwd, ".loom", project, "mockup");
    if (!fs.existsSync(dir)) {
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
    return new Response(JSON.stringify({ files }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/fabric/mockup/file"] = async (req, url) => {
    const cwd = url.searchParams.get("cwd") ?? "";
    const project = url.searchParams.get("project") ?? "";
    const file = url.searchParams.get("file") ?? "";
    // Path traversal guard: must be a plain filename.
    if (!cwd || !project || !file || file.includes("/") || file.includes("..")) {
      return new Response("bad request", { status: 400 });
    }
    const full = path.join(cwd, ".loom", project, "mockup", file);
    if (!fs.existsSync(full)) return new Response("not found", { status: 404 });
    const body = fs.readFileSync(full, "utf8");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Sandboxed via Content-Security-Policy + iframe sandbox attribute on the consumer.
        "content-security-policy": "default-src 'self' https: data: 'unsafe-inline'; script-src 'none'",
      },
    });
  };
}
