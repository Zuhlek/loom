// Provider-routed RPC surface. Unknown-provider remotes return 404.
// ProviderAuthError → 401 so the web layer can prompt for credentials.

import { jsonResponse, methodNotAllowed } from "./_response.ts";
import { getProvider as defaultGetProvider } from "../source-control/index.ts";
import { getRemoteUrl as defaultGetRemoteUrl } from "../git/manager.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";
import type { SourceControlProviderShape } from "../source-control/types.ts";
import {
  emitChatMetaChanged,
  providerErrorResponse,
} from "./_route-helpers.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export interface SourceControlRouteDeps {
  getProvider?: (remoteUrl: string) => SourceControlProviderShape | null;
  getRemoteUrl?: (cwd: string, remote?: string) => Promise<string | null>;
}

async function resolveProviderForCwd(
  cwd: string,
  getProvider: (url: string) => SourceControlProviderShape | null,
  getRemoteUrl: (cwd: string, remote?: string) => Promise<string | null>,
): Promise<{ provider: SourceControlProviderShape; remoteUrl: string } | null> {
  let remoteUrl: string | null;
  try {
    remoteUrl = await getRemoteUrl(cwd, "origin");
  } catch {
    return null;
  }
  if (!remoteUrl) return null;
  const provider = getProvider(remoteUrl);
  if (!provider) return null;
  return { provider, remoteUrl };
}

export function mountSourceControlRoute(
  routes: Record<string, Handler>,
  store: MetadataStore,
  broadcast: (frame: ServerFrame) => void,
  deps: SourceControlRouteDeps = {},
): void {
  const getProvider = deps.getProvider ?? defaultGetProvider;
  const getRemoteUrl = deps.getRemoteUrl ?? defaultGetRemoteUrl;

  routes["/source-control/list-prs"] = async (req, url) => {
    if (req.method !== "GET") return methodNotAllowed();
    const cwd = url.searchParams.get("cwd") ?? "";
    if (!cwd) return jsonResponse({ error: "cwd required" }, 400);
    const stateRaw = (url.searchParams.get("state") ?? "open") as "open" | "closed" | "all";
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const resolved = await resolveProviderForCwd(cwd, getProvider, getRemoteUrl);
    if (!resolved) return jsonResponse({ error: "unsupported provider" }, 404);
    try {
      const prs = await resolved.provider.listChangeRequests({ cwd, state: stateRaw, limit });
      return jsonResponse({ prs }, 200);
    } catch (e) {
      return providerErrorResponse(e);
    }
  };

  routes["/source-control/get-pr"] = async (req, url) => {
    if (req.method !== "GET") return methodNotAllowed();
    const cwd = url.searchParams.get("cwd") ?? "";
    const reference = url.searchParams.get("reference") ?? "";
    if (!cwd) return jsonResponse({ error: "cwd required" }, 400);
    if (!reference) return jsonResponse({ error: "reference required" }, 400);
    const resolved = await resolveProviderForCwd(cwd, getProvider, getRemoteUrl);
    if (!resolved) return jsonResponse({ error: "unsupported provider" }, 404);
    try {
      const pr = await resolved.provider.getChangeRequest({ cwd, reference });
      return jsonResponse({ pr }, 200);
    } catch (e) {
      return providerErrorResponse(e);
    }
  };

  routes["/source-control/checkout-cr"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const chatId = body?.chatId;
    const reference = body?.reference;
    if (typeof chatId !== "string" || chatId.length === 0) {
      return jsonResponse({ error: "chatId required" }, 400);
    }
    if (typeof reference !== "string" || reference.length === 0) {
      return jsonResponse({ error: "reference required" }, 400);
    }
    const chat = store.chats.get(chatId);
    if (!chat) return jsonResponse({ error: "chat not found" }, 404);
    if (chat.vcs_kind === "unknown") {
      return jsonResponse({ error: "not a git repo" }, 400);
    }
    const cwd = chat.worktree_path ?? chat.cwd;
    const resolved = await resolveProviderForCwd(cwd, getProvider, getRemoteUrl);
    if (!resolved) return jsonResponse({ error: "unsupported provider" }, 404);
    try {
      const result = await resolved.provider.checkoutChangeRequest({ cwd, reference });
      const row = store.chats.update(chatId, { branch: result.branch });
      emitChatMetaChanged(broadcast, chatId, row!.branch, row!.worktree_path);
      return jsonResponse({ worktreePath: cwd, branch: result.branch, row }, 200);
    } catch (e) {
      return providerErrorResponse(e);
    }
  };

  routes["/source-control/default-branch"] = async (req, url) => {
    if (req.method !== "GET") return methodNotAllowed();
    const cwd = url.searchParams.get("cwd") ?? "";
    if (!cwd) return jsonResponse({ error: "cwd required" }, 400);
    const resolved = await resolveProviderForCwd(cwd, getProvider, getRemoteUrl);
    if (!resolved) return jsonResponse({ error: "unsupported provider" }, 404);
    try {
      const branch = await resolved.provider.getDefaultBranch({ cwd });
      return jsonResponse({ branch }, 200);
    } catch (e) {
      return providerErrorResponse(e);
    }
  };

  routes["/git/pr"] = async (req) => {
    if (req.method !== "POST") return methodNotAllowed();
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }
    const cwd = body?.worktreePath;
    const title = body?.title;
    const head = body?.head;
    const base = body?.base ?? "main";
    if (typeof cwd !== "string" || cwd.length === 0) {
      return jsonResponse({ error: "worktreePath required" }, 400);
    }
    if (typeof title !== "string" || title.length === 0) {
      return jsonResponse({ error: "title required" }, 400);
    }
    if (typeof head !== "string" || head.length === 0) {
      return jsonResponse({ error: "head required" }, 400);
    }
    const resolved = await resolveProviderForCwd(cwd, getProvider, getRemoteUrl);
    if (!resolved) return jsonResponse({ error: "unsupported provider" }, 404);
    try {
      const pr = await resolved.provider.createPr({
        cwd,
        remoteUrl: resolved.remoteUrl,
        head,
        base,
        title,
        body: typeof body?.body === "string" ? body.body : undefined,
      });
      return jsonResponse({ url: pr.url, number: pr.number, provider: resolved.provider.kind }, 200);
    } catch (e) {
      return providerErrorResponse(e);
    }
  };
}
