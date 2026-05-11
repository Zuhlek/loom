/**
 * Chat routes.
 *
 *   POST   /chats           — create a new Chat row.
 *                             Body: { cwd, permissionMode?, worktreeMode?,
 *                                     projectId?, projectName? (legacy) }.
 *                             projectId is the new contract (project-first
 *                             flow). projectName is still honoured for
 *                             backward compat — if both are missing the
 *                             chat lands in the Unassigned bucket.
 *                             Returns: { chat }.
 *   GET    /chats           — list all chats.
 *   GET    /chats/get?id=   — fetch one chat by id.
 *   DELETE /chats/delete?id=— delete a chat row, SIGTERM its PTY if running.
 *                             Returns: 204 No Content.
 *
 * Spawning the underlying claude PTY is deferred to the WS attach handler
 * so we don't burn a process before the user actually opens the chat.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatPtyBridge } from "../process-manager/chat-pty-bridge.ts";
import { invalidateLoomCache } from "./sidebar.ts";

function newId(): string {
  return (
    "c_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

export function mountChatsRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  bridge?: ChatPtyBridge,
): void {
  routes["/chats"] = async (req) => {
    if (req.method === "GET") {
      return new Response(JSON.stringify({ chats: store.chats.list() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
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
    const cwd = body?.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) {
      return new Response(JSON.stringify({ error: "cwd required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const permissionMode = body?.permissionMode ?? "default";
    const worktreeMode = body?.worktreeMode === "worktree" ? "worktree" : "local";

    let projectId: string | null = null;
    // New project-first flow: caller passes a projectId for an existing
    // project. We validate it exists and that the submitted cwd is one of
    // the project's declared paths — otherwise we'd be creating a chat
    // outside its project, which is a category violation.
    if (typeof body?.projectId === "string" && body.projectId.length > 0) {
      const proj = store.projects.get(body.projectId);
      if (!proj) {
        return new Response(JSON.stringify({ error: "project not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (!proj.paths.includes(cwd)) {
        return new Response(
          JSON.stringify({
            error: "cwd must be one of the project's declared paths",
            cwd,
            projectPaths: proj.paths,
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      projectId = proj.id;
    } else if (typeof body?.projectName === "string" && body.projectName.trim().length > 0) {
      // Legacy projectName flow — still honoured so older callers and the
      // existing chats-route tests keep working. Auto-creates a project if
      // none exists with that name.
      const name = body.projectName.trim();
      const existing = store.projects.getByName(name);
      const proj = existing ?? store.projects.create({ name, paths: [cwd] });
      if (!proj.paths.includes(cwd)) {
        store.projects.addPath(proj.id, cwd);
      }
      projectId = proj.id;
    }

    const id = newId();
    const chat = store.chats.create({
      id,
      project_id: projectId,
      cwd,
      permission_mode: permissionMode,
      worktree_mode: worktreeMode,
    });

    // A new chat may run /weave and create a .loom/ directory; invalidate
    // the loom cache so the next sidebar refresh re-scans.
    invalidateLoomCache();

    return new Response(JSON.stringify({ chat }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/chats/get"] = async (req, url) => {
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "id required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const chat = store.chats.get(id);
    if (!chat) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ chat }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  routes["/chats/delete"] = async (req, url) => {
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
    const chat = store.chats.get(id);
    if (!chat) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    // Tear down the PTY if one is running, then drop the row.
    if (bridge) {
      try {
        bridge.dispose(id);
      } catch {}
    }
    store.chats.delete(id);
    invalidateLoomCache();
    return new Response(null, { status: 204 });
  };
}
