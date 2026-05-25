/**
 * Fabric archive routes.
 *
 *   POST   /fabric/archive    body { id, projectId, fabricName, cwd }
 *                              → archive the fabric (sidebar will hide it).
 *   POST   /fabric/unarchive  body { id }
 *                              → restore the fabric to the sidebar.
 *   GET    /fabric/archived   → list of archived fabric rows.
 *
 * Archiving is a UI concern; the on-disk `.loom/<name>/` directory is
 * never touched.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import { jsonResponse } from "./_response.ts";
import { invalidateFabricCache } from "./sidebar.ts";

export function mountFabricArchiveRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/fabric/archive"] = async (req) => {
    if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const fabricName = typeof body?.fabricName === "string" ? body.fabricName : "";
    const cwd = typeof body?.cwd === "string" ? body.cwd : "";
    if (!id || !projectId || !fabricName || !cwd) {
      return jsonResponse({ error: "id, projectId, fabricName, cwd required" }, 400);
    }
    const row = store.archivedFabrics.archive({ id, projectId, fabricName, cwd });
    invalidateFabricCache();
    return jsonResponse({ archived: row }, 200);
  };

  routes["/fabric/unarchive"] = async (req) => {
    if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
    const body = await req.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return jsonResponse({ error: "id required" }, 400);
    const removed = store.archivedFabrics.unarchive(id);
    invalidateFabricCache();
    return jsonResponse({ ok: removed }, removed ? 200 : 404);
  };

  routes["/fabric/archived"] = async (req) => {
    if (req.method !== "GET") return jsonResponse({ error: "method not allowed" }, 405);
    return jsonResponse({ archived: store.archivedFabrics.list() }, 200);
  };
}

