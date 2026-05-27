import * as crypto from "node:crypto";
import * as path from "node:path";
import {
  createWorktree,
  removeWorktree,
} from "../git/worktree.ts";
import { invalidateVcsKindCache } from "../git/vcs-kind.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";
import { jsonResponse } from "./_response.ts";
import {
  errorMessage,
  getProjectDefaultBranch,
  emitChatMetaChanged,
} from "./_route-helpers.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export function mountGitWorktreeRoute(
  routes: Record<string, Handler>,
  store: MetadataStore,
  broadcast: (frame: ServerFrame) => void,
): void {
  routes["/git/createWorktree"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const chatId = body?.chatId;
    if (typeof chatId !== "string" || chatId.length === 0) {
      return jsonResponse({ error: "chatId required" }, 400);
    }
    const chat = store.chats.get(chatId);
    if (!chat) return jsonResponse({ error: "chat not found" }, 404);
    if (chat.vcs_kind === "unknown") {
      return jsonResponse({ error: "not a git repo" }, 400);
    }
    const branch = typeof body?.branch === "string" && body.branch.length > 0
      ? body.branch
      : `loom/${chatId}`;
    const sha8 = crypto.createHash("sha1").update(`${chatId}:${branch}`).digest("hex").slice(0, 8);
    const worktreePath = path.resolve(chat.cwd, ".loom-worktrees", chatId, sha8);
    try {
      await createWorktree({
        parentCwd: chat.cwd,
        worktreePath,
        newBranch: branch,
      });
      invalidateVcsKindCache(worktreePath);
      const row = store.chats.update(chatId, {
        worktree_path: worktreePath,
        worktree_mode: "worktree",
        branch,
      });
      emitChatMetaChanged(broadcast, chatId, row!.branch, row!.worktree_path);
      return jsonResponse({ worktreePath, branch, row }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

  routes["/git/removeWorktree"] = async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const worktreePath = body?.worktreePath;
    if (typeof worktreePath !== "string" || worktreePath.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    const force = body?.force === true;

    const tenants = store.chats
      .list()
      .filter((c) => c.worktree_path === worktreePath)
      .map((c) => c.id);

    if (tenants.length > 1 && !force) {
      return jsonResponse(
        { co_tenants: tenants, require_confirm: true },
        409,
      );
    }
    const firstTenant = tenants[0] ? store.chats.get(tenants[0]) : null;
    const parentCwd = firstTenant?.cwd;
    if (!parentCwd) {
      return jsonResponse({ error: "no tenant chat found for worktree" }, 404);
    }
    try {
      await removeWorktree(parentCwd, worktreePath);
      invalidateVcsKindCache(worktreePath);
      const defaultBranch = await getProjectDefaultBranch(parentCwd);
      for (const tid of tenants) {
        const row = store.chats.update(tid, {
          worktree_path: null,
          worktree_mode: "local",
          branch: defaultBranch,
        });
        emitChatMetaChanged(broadcast, tid, row!.branch, row!.worktree_path);
      }
      return jsonResponse({ removed: true }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };
}
