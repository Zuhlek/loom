/**
 * GET /discover/scan — scans common parents and returns matches.
 * POST /discover/save — writes ~/.nora/config.json with chosen root.
 */
import { scanCommonParents, isAbsolutePath } from "../discover-wizard-service/index.ts";
import { writeConfig } from "../config-loader/index.ts";

export function mountDiscoverRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/discover/scan"] = async () => {
    const result = scanCommonParents();
    return new Response(JSON.stringify({ parents: result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/discover/save"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const root = body?.root;
    if (typeof root !== "string" || root.length === 0 || !isAbsolutePath(root)) {
      return new Response(JSON.stringify({ error: "root must be an absolute path" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const configPath = body?.configPath ?? undefined;
    try {
      const finalPath = configPath ?? `${process.env.HOME}/.nora/config.json`;
      writeConfig(finalPath, { root });
      return new Response(JSON.stringify({ ok: true, configPath: finalPath, root }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };
}
