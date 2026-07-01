import { executeGit } from "../git/worktree.ts";
import { resolveBranchSelectionTarget } from "../git/resolve-branch-selection-target.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";
import { jsonResponse, methodNotAllowed } from "./_response.ts";
import {
  errorMessage,
  getProjectDefaultBranch,
  emitChatMetaChanged,
} from "./_route-helpers.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export function mountGitVerbsRoute(
  routes: Record<string, Handler>,
  store: MetadataStore,
  broadcast: (frame: ServerFrame) => void,
): void {
  routes["/git/switchRef"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const chatId = body?.chatId;
    const refName = body?.refName;
    if (typeof chatId !== "string" || chatId.length === 0) {
      return jsonResponse({ error: "chatId required" }, 400);
    }
    if (typeof refName !== "string" || refName.length === 0) {
      return jsonResponse({ error: "refName required" }, 400);
    }
    const chat = store.chats.get(chatId);
    if (!chat) return jsonResponse({ error: "chat not found" }, 404);
    if (chat.vcs_kind === "unknown") {
      return jsonResponse({ error: "not a git repo" }, 400);
    }
    const defaultBranch = await getProjectDefaultBranch(chat.cwd);
    const target = resolveBranchSelectionTarget({
      activeProjectCwd: chat.cwd,
      activeWorktreePath: chat.worktree_path,
      refName: {
        isDefault: refName === defaultBranch,
        worktreePath: null,
        name: refName,
      },
    });
    const checkoutCwd = target.checkoutCwd;
    try {
      if (target.kind === "switch") {
        await executeGit(checkoutCwd, ["checkout", refName]);
      } else if (target.kind === "drop") {
        await executeGit(checkoutCwd, ["checkout", defaultBranch]);
      }
      const newBranch = target.kind === "drop" ? defaultBranch : refName;
      const row = store.chats.update(chatId, { branch: newBranch });
      emitChatMetaChanged(broadcast, chatId, row!.branch, row!.worktree_path);
      return jsonResponse({ result: target.kind, row }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };

  routes["/git/createRef"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const chatId = body?.chatId;
    const newBranch = body?.newBranch;
    const baseRef = body?.baseRef;
    if (typeof chatId !== "string" || chatId.length === 0) {
      return jsonResponse({ error: "chatId required" }, 400);
    }
    if (typeof newBranch !== "string" || newBranch.length === 0) {
      return jsonResponse({ error: "newBranch required" }, 400);
    }
    const chat = store.chats.get(chatId);
    if (!chat) return jsonResponse({ error: "chat not found" }, 404);
    if (chat.vcs_kind === "unknown") {
      return jsonResponse({ error: "not a git repo" }, 400);
    }
    const cwd = chat.worktree_path ?? chat.cwd;
    try {
      const args = ["checkout", "-b", newBranch];
      if (typeof baseRef === "string" && baseRef.length > 0) args.push(baseRef);
      await executeGit(cwd, args);
      const row = store.chats.update(chatId, { branch: newBranch });
      emitChatMetaChanged(broadcast, chatId, row!.branch, row!.worktree_path);
      return jsonResponse({ branch: newBranch, row }, 200);
    } catch (e) {
      return jsonResponse({ error: errorMessage(e) }, 500);
    }
  };
}
