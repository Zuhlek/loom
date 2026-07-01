import * as fs from "node:fs";
import * as path from "node:path";
import { listWorktrees, removeWorktree } from "../git/worktree.ts";
import { invalidateVcsKindCache } from "../git/vcs-kind.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";
import { jsonResponse, methodNotAllowed } from "./_response.ts";
import {
  errorMessage,
  getProjectDefaultBranch,
  emitChatMetaChanged,
} from "./_route-helpers.ts";

function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

function tenantsFor(store: MetadataStore, worktreePath: string): string[] {
  const target = canonicalize(worktreePath);
  return store.chats
    .list()
    .filter((c) => {
      if (!c.worktree_path) return false;
      return c.worktree_path === worktreePath || canonicalize(c.worktree_path) === target;
    })
    .map((c) => c.id);
}

export function mountWorktreesRoute(
  routes: Record<string, Handler>,
  store: MetadataStore,
  serverCwd: string,
  broadcast?: (frame: ServerFrame) => void,
): void {
  routes["/worktrees"] = async (req) => {
    if (req.method !== "GET") return methodNotAllowed();
    try {
      const wts = await listWorktrees(serverCwd);
      const enriched = wts.map((w) => ({
        ...w,
        tenantChatIds: tenantsFor(store, w.path),
      }));
      return jsonResponse({ worktrees: enriched }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

  routes["/worktrees/delete"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
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
    const confirm = body?.confirm === true;
    const tenants = tenantsFor(store, worktreePath);
    if (tenants.length > 1 && !confirm) {
      return jsonResponse(
        { co_tenants: tenants, require_confirm: true },
        409,
      );
    }
    try {
      await removeWorktree(serverCwd, worktreePath);
      invalidateVcsKindCache(worktreePath);
      const defaultBranch = await getProjectDefaultBranch(serverCwd);
      for (const id of tenants) {
        const row = store.chats.update(id, {
          worktree_path: null,
          worktree_mode: "local",
          branch: defaultBranch,
        });
        // ADR carry-over: chat-level removeWorktree already broadcasts
        // this frame per tenant. Project-level delete must do the same
        // so each WS subscriber refreshes its row without a reload.
        if (broadcast && row) {
          emitChatMetaChanged(broadcast, id, row.branch, row.worktree_path);
        }
      }
      return jsonResponse({ removed: true }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };
}
