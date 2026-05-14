/**
 * Project routes:
 *   GET    /projects               — list
 *   POST   /projects               — create { name, paths } (legacy paths array)
 *                                    OR { name, initialCwd } (new project-first flow).
 *                                    Returns 201 + { project } on success.
 *                                    Returns 409 + { error, project } when a project
 *                                    with the same name already exists (caller may
 *                                    decide to reuse it from the dialog).
 *   POST   /projects/path/add      — { id, path } add path to existing project
 *   POST   /projects/path/remove   — { id, path } remove path
 *   DELETE /projects/delete?id=    — cascade-delete a project. Tears down each
 *                                    of its chats' PTYs (via bridge) and drops
 *                                    the rows. Mirrors t3code's project.delete
 *                                    decider behavior (with implicit force).
 *                                    Returns: 204 No Content.
 */
import * as fs from "node:fs";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ClaudeSessionBridge } from "../process-manager/claude-session-bridge.ts";
import { invalidateFabricCache } from "./sidebar.ts";

const NAME_RX = /^[A-Za-z0-9](?:[A-Za-z0-9-_ ]{0,62}[A-Za-z0-9])?$/;

export function mountProjectsRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  bridge?: ClaudeSessionBridge,
): void {
  routes["/projects"] = async (req) => {
    if (req.method === "GET") {
      return new Response(JSON.stringify({ projects: store.projects.list() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: "invalid json" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) {
        return new Response(JSON.stringify({ error: "name required" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (!NAME_RX.test(name)) {
        return new Response(
          JSON.stringify({ error: "name must be alphanumeric (dashes, underscores, spaces allowed)" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      // Resolve paths: prefer { initialCwd } (new flow), fall back to { paths }
      // (legacy multi-path flow used by some internal callers).
      let paths: string[] = [];
      if (typeof body?.initialCwd === "string" && body.initialCwd.trim().length > 0) {
        paths = [body.initialCwd.trim()];
      } else if (Array.isArray(body?.paths) && body.paths.length > 0) {
        paths = body.paths.filter((p: any) => typeof p === "string" && p.length > 0);
      }
      if (paths.length === 0) {
        return new Response(
          JSON.stringify({ error: "initialCwd (or paths[]) required" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      // Validate each path actually exists on disk so we don't create
      // ghost projects pointing at nothing.
      for (const p of paths) {
        if (!fs.existsSync(p)) {
          return new Response(
            JSON.stringify({ error: `path does not exist: ${p}`, path: p }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      // Duplicate-name guard: surface 409 with the existing project so the
      // dialog can offer "open in existing" without auto-merging silently.
      const existing = store.projects.getByName(name);
      if (existing) {
        return new Response(
          JSON.stringify({ error: "project with this name already exists", project: existing }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }

      const project = store.projects.create({ name, paths });
      return new Response(JSON.stringify({ project }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("method not allowed", { status: 405 });
  };

  // Path-mutation endpoints. Use query string for project id.
  routes["/projects/path/add"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await req.json().catch(() => null);
    if (!body?.id || !body?.path) {
      return new Response(JSON.stringify({ error: "id + path required" }), { status: 400 });
    }
    const p = store.projects.addPath(body.id, body.path);
    if (!p) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify({ project: p }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/projects/path/remove"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await req.json().catch(() => null);
    if (!body?.id || !body?.path) {
      return new Response(JSON.stringify({ error: "id + path required" }), { status: 400 });
    }
    const p = store.projects.removePath(body.id, body.path);
    if (!p) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify({ project: p }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/projects/delete"] = async (req, url) => {
    if (req.method !== "DELETE" && req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "id required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const proj = store.projects.get(id);
    if (!proj) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    // Cascade: dispose each child chat's PTY then drop the row, mirroring
    // the per-chat DELETE flow.
    const childChats = store.chats.listByProject(id);
    for (const c of childChats) {
      if (bridge) {
        try {
          bridge.dispose(c.id);
        } catch {}
      }
      store.chatItems.clear(c.id);
      store.chats.delete(c.id);
    }
    store.projects.delete(id);
    invalidateFabricCache();
    return new Response(null, { status: 204 });
  };
}
