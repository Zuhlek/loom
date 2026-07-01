import * as fs from "node:fs";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";
import { jsonResponse, methodNotAllowed } from "./_response.ts";
import { emitChatMetaChanged } from "./_route-helpers.ts";

export type ServerFrameBroadcast = (frame: ServerFrame) => void;

export function mountChatsMetaRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  broadcast: ServerFrameBroadcast,
): void {
  routes["/chats/meta"] = async (req) => {
    if (req.method !== "PATCH") {
      return methodNotAllowed();
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const id = body?.id;
    if (typeof id !== "string" || id.length === 0) {
      return jsonResponse({ error: "id required" }, 400);
    }
    const chat = store.chats.get(id);
    if (!chat) {
      return jsonResponse({ error: "chat not found" }, 404);
    }

    const patch: { branch?: string | null; worktree_path?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(body, "branch")) {
      const v = body.branch;
      if (v !== null && typeof v !== "string") {
        return jsonResponse({ error: "branch must be string or null" }, 400);
      }
      patch.branch = v;
    }
    if (Object.prototype.hasOwnProperty.call(body, "worktree_path")) {
      const v = body.worktree_path;
      if (v !== null && typeof v !== "string") {
        return jsonResponse({ error: "worktree_path must be string or null" }, 400);
      }
      if (v !== null && !fs.existsSync(v)) {
        return jsonResponse({ error: "worktree path does not exist", worktree_path: v }, 400);
      }
      patch.worktree_path = v;
    }

    const row = store.chats.update(id, patch as any);
    if (!row) {
      return jsonResponse({ error: "chat not found" }, 404);
    }
    emitChatMetaChanged(broadcast, id, row.branch, row.worktree_path);
    return jsonResponse({ row }, 200);
  };
}
