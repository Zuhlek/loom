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
import { spawn as childSpawn, execFileSync } from "node:child_process";

import type { MetadataStore } from "../metadata-store/index.ts";
import type { JsonlTailBridge } from "../process-manager/jsonl/bridge.ts";
import { jsonResponse, methodNotAllowed } from "./_response.ts";
import { decorateChat } from "./chat-decorator.ts";
import { invalidateFabricCache } from "./sidebar.ts";

/**
 * Handoff session payload — kept local to this module. `handoff.ts` is
 * intentionally deleted; the launcher logic lives inline at the only
 * site that ever called it (this file).
 */
export interface HandoffSession {
  chatId: string;
}

export interface HandoffResult {
  ok: boolean;
  error?: string;
  launched?: { command: string; pid: number };
}

export interface ChatsRouteDeps {
  /** Injectable for tests. Defaults to the inlined launcher below. */
  launchHandoffTerminal?: (session: HandoffSession) => Promise<HandoffResult>;
}

/**
 * Inlined handoff launcher — opens the host's native terminal attached
 * to the chat's tmux session (`tmux attach-session -t loom-<chatId>`).
 *
 *   - macOS: `open -a Terminal.app -n --args bash -lc "tmux attach-session -t loom-<id>"`.
 *   - Linux: chain `x-terminal-emulator` → `gnome-terminal` → `konsole`
 *     → `xterm` (first-hit wins via `which`).
 *   - Windows / other: returns `{ ok: false, error }` without spawning.
 */
function defaultLaunchHandoffTerminal(
  session: HandoffSession,
): Promise<HandoffResult> {
  const platform = process.platform;
  const tmuxCmd = `tmux attach-session -t loom-${session.chatId}`;

  function which(cmd: string): string | null {
    try {
      const out = execFileSync("/usr/bin/env", ["which", cmd], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const path = out.toString().trim();
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }

  if (platform === "darwin") {
    const args = ["-a", "Terminal.app", "-n", "--args", "bash", "-lc", tmuxCmd];
    const child = childSpawn("open", args, { detached: true, stdio: "ignore" });
    child.unref?.();
    return Promise.resolve({
      ok: true,
      launched: { command: `open ${args.join(" ")}`, pid: child.pid ?? 0 },
    });
  }

  if (platform === "linux") {
    // Order: x-terminal-emulator is the Debian/Ubuntu meta-symlink that
    // honours the user's default; the others are explicit fallbacks.
    const chain = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
    for (const term of chain) {
      if (which(term)) {
        const child = childSpawn(term, ["-e", "bash", "-lc", tmuxCmd], {
          detached: true,
          stdio: "ignore",
        });
        child.unref?.();
        return Promise.resolve({
          ok: true,
          launched: { command: `${term} -e bash -lc "${tmuxCmd}"`, pid: child.pid ?? 0 },
        });
      }
    }
    return Promise.resolve({
      ok: false,
      error:
        "No supported terminal emulator found. Install one of: " + chain.join(", "),
    });
  }

  if (platform === "win32") {
    return Promise.resolve({
      ok: false,
      error:
        "Windows is not supported for handoff in v1 (use WSL — see setup docs).",
    });
  }

  return Promise.resolve({ ok: false, error: `Unsupported platform: ${platform}` });
}

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
  bridge?: JsonlTailBridge,
  deps: ChatsRouteDeps = {},
): void {
  const launchHandoffTerminal = deps.launchHandoffTerminal ?? defaultLaunchHandoffTerminal;
  routes["/chats"] = async (req) => {
    if (req.method === "GET") {
      const chats = store.chats.list().map((row) => decorateChat(row, store));
      return jsonResponse({ chats }, 200);
    }
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const cwd = body?.cwd;
    if (typeof cwd !== "string" || cwd.length === 0) {
      return jsonResponse({ error: "cwd required" }, 400);
    }
    const permissionMode = body?.permissionMode ?? "default";
    // `worktree_mode` is left as `null` on creation when the request
    // doesn't provide it — the first-send hook commits the resolved
    // `defaultEnvMode` once the user sends their first message. Explicit
    // request-time values ("local" or "worktree") are honoured and
    // bypass the hook's mode-resolution.
    let worktreeMode: "local" | "worktree" | null = null;
    if (body?.worktreeMode === "worktree") worktreeMode = "worktree";
    else if (body?.worktreeMode === "local") worktreeMode = "local";

    let projectId: string | null = null;
    // New project-first flow: caller passes a projectId for an existing
    // project. We validate it exists and that the submitted cwd is one of
    // the project's declared paths — otherwise we'd be creating a chat
    // outside its project, which is a category violation.
    if (typeof body?.projectId === "string" && body.projectId.length > 0) {
      const proj = store.projects.get(body.projectId);
      if (!proj) {
        return jsonResponse({ error: "project not found" }, 404);
      }
      if (!proj.paths.includes(cwd)) {
        return jsonResponse(
          {
            error: "cwd must be one of the project's declared paths",
            cwd,
            projectPaths: proj.paths,
          },
          400,
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
    // the fabric cache so the next sidebar refresh re-scans.
    invalidateFabricCache();

    return jsonResponse({ chat: decorateChat(chat, store) }, 200);
  };

  routes["/chats/get"] = async (req, url) => {
    const id = url.searchParams.get("id");
    if (!id) {
      return jsonResponse({ error: "id required" }, 400);
    }
    const chat = store.chats.get(id);
    if (!chat) {
      return jsonResponse({ error: "not found" }, 404);
    }
    return jsonResponse({ chat: decorateChat(chat, store) }, 200);
  };

  routes["/chats/delete"] = async (req, url) => {
    if (req.method !== "DELETE" && req.method !== "POST") {
      return methodNotAllowed();
    }
    const id = url.searchParams.get("id");
    if (!id) {
      return jsonResponse({ error: "id required" }, 400);
    }
    const chat = store.chats.get(id);
    if (!chat) {
      return jsonResponse({ error: "not found" }, 404);
    }
    // Tear down the PTY if one is running, then drop the row.
    if (bridge) {
      try {
        bridge.dispose(id);
      } catch {}
    }
    // Clear the durable chat-items log so the next chat reusing this
    // id (unlikely with UUIDs, but the invariant matters) doesn't
    // inherit stale timeline rows.
    store.chatItems.clear(id);
    store.chats.delete(id);
    invalidateFabricCache();
    return new Response(null, { status: 204 });
  };

  routes["/chats/fork"] = async (req, url) => {
    if (req.method !== "POST") {
      return methodNotAllowed();
    }
    const id = url.searchParams.get("id");
    if (!id) {
      return jsonResponse({ error: "id required" }, 400);
    }
    const source = store.chats.get(id);
    if (!source) {
      return jsonResponse({ error: "not found" }, 404);
    }
    const forked = store.chats.create({
      id: newId(),
      project_id: source.project_id,
      cwd: source.cwd,
      permission_mode: source.permission_mode,
      worktree_mode: source.worktree_mode,
      // session_id is omitted so chatRepo.create() generates a fresh
      // UUID. pid / inert / worktree_path reset to their defaults.
    });
    invalidateFabricCache();
    return jsonResponse({ chat: decorateChat(forked, store) }, 200);
  };

  routes["/chats/rename"] = async (req, url) => {
    if (req.method !== "POST") {
      return methodNotAllowed();
    }
    const id = url.searchParams.get("id");
    if (!id) {
      return jsonResponse({ error: "missing id" }, 400);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid body" }, 400);
    }
    const customName = body?.customName;
    if (customName !== null && typeof customName !== "string") {
      return jsonResponse({ error: "invalid customName" }, 400);
    }
    let effective: string | null;
    if (customName === null) {
      effective = null;
    } else {
      const trimmed = customName.trim();
      if (trimmed.length > 80) {
        return jsonResponse({ error: "customName too long" }, 400);
      }
      effective = trimmed.length === 0 ? null : trimmed;
    }
    let row;
    try {
      row = store.chats.setCustomName(id, effective);
    } catch (err) {
      if (err instanceof Error && err.message === "chat not found") {
        return jsonResponse({ error: "chat not found" }, 404);
      }
      throw err;
    }
    return jsonResponse({ chat: decorateChat(row, store) }, 200);
  };

  routes["/chats/handoff"] = async (req, url) => {
    if (req.method !== "POST") {
      return methodNotAllowed();
    }
    const id = url.searchParams.get("id");
    if (!id) {
      return jsonResponse({ error: "id required" }, 400);
    }
    const chat = store.chats.get(id);
    if (!chat) {
      return jsonResponse({ error: "not found" }, 404);
    }
    const hasSession =
      bridge !== undefined ? await Promise.resolve(bridge.hasSession(id)) : false;
    if (!bridge || !hasSession) {
      return jsonResponse({ error: "no live session" }, 409);
    }
    const result = await launchHandoffTerminal({ chatId: id });
    if (!result.ok) {
      return jsonResponse({ error: result.error ?? "handoff failed" }, 500);
    }
    // PTY is intentionally NOT disposed — the tmux session keeps running
    // and the new terminal re-attaches via `tmux attach-session`. Both
    // surfaces share the tmux session; neither owns it.
    return jsonResponse(
      { ok: true, command: result.launched?.command ?? "" },
      200,
    );
  };
}
