/**
 * GET /discover/scan — scans common parents and returns matches.
 * POST /discover/save — writes ~/.loom/config.json with chosen root.
 */
import { scanCommonParents, isAbsolutePath } from "../discover-wizard-service/index.ts";
import { writeConfig } from "../config-loader/index.ts";
import { jsonResponse } from "./_response.ts";

export function mountDiscoverRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
): void {
  routes["/discover/scan"] = async () => {
    const result = scanCommonParents();
    return jsonResponse({ parents: result }, 200);
  };

  routes["/discover/save"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const root = body?.root;
    if (typeof root !== "string" || root.length === 0 || !isAbsolutePath(root)) {
      return jsonResponse({ error: "root must be an absolute path" }, 400);
    }
    const configPath = body?.configPath ?? undefined;
    try {
      const finalPath = configPath ?? `${process.env.HOME}/.loom/config.json`;
      writeConfig(finalPath, { root });
      return jsonResponse({ ok: true, configPath: finalPath, root }, 200);
    } catch (err: any) {
      return jsonResponse({ error: err.message }, 500);
    }
  };
}
