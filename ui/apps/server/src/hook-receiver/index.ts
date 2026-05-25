/**
 * POST /hooks/event — Claude Code's user-scope hooks call this.
 *
 * Origin-checked at the server layer. Each event is mapped to a chat-id
 * (either legacy explicit `chatId`, or — for real Claude Code payloads
 * — by reverse-looking-up `session_id` in the SessionIdStore), then
 * normalised into a chat-protocol envelope. PendingGate rows are
 * persisted when the channel indicates AskUserQuestion or
 * PermissionRequest, and cleared on Stop / SubagentStop.
 *
 * Events that cannot be mapped to a chat are dropped silently (200
 * with `dropped: true`). Returning a non-200 here would trigger
 * claude's hook retry path, which we never want.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import type { SessionIdStore } from "../process-manager/session-store.ts";
import { normalizeHookEvent, type ClaudeHookEvent } from "./normalize.ts";

export type EnvelopeBroadcaster = (envelope: any) => void;

let broadcaster: EnvelopeBroadcaster | null = null;
const lastWarnings: string[] = [];
let lastDelivered: { channel: string; at: string } | null = null;

export function setEnvelopeBroadcaster(b: EnvelopeBroadcaster | null) {
  broadcaster = b;
}

export function getRecentHookWarnings(): string[] {
  return lastWarnings.slice(-50);
}

export function getLastDelivered(): { channel: string; at: string } | null {
  return lastDelivered;
}

export function resetLastDelivered(): void {
  lastDelivered = null;
}

export function mountHookReceiver(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  sessionStore?: SessionIdStore,
): void {
  routes["/hooks/event"] = async (req: Request) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: ClaudeHookEvent;
    try {
      body = (await req.json()) as ClaudeHookEvent;
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    if (
      !body ||
      (typeof body.channel !== "string" &&
        typeof (body as { hook_event_name?: unknown }).hook_event_name !== "string")
    ) {
      return new Response("missing channel", { status: 400 });
    }
    const channel = (body.hook_event_name ?? body.channel) as string;
    lastDelivered = { channel, at: new Date().toISOString() };

    if (process.env.LOOM_TRACE_HOOKS === "1") {
      console.warn(
        `[loom hook trace] channel=${channel} tool_name=${
          (body as { tool_name?: unknown }).tool_name ?? ""
        } session_id=${body.session_id ?? ""} body=${JSON.stringify(body).slice(0, 2000)}`,
      );
    }

    // Resolve chat-id: legacy explicit `chatId`, else reverse-lookup by
    // Claude's `session_id`. If neither resolves, drop silently — we
    // never want to trigger claude's hook retry.
    let chatId: string | undefined = body.chatId;
    if (!chatId) {
      const claudeSessionId = body.session_id;
      if (claudeSessionId && sessionStore) {
        try {
          chatId = await sessionStore.findByClaudeSessionId(claudeSessionId);
        } catch {
          chatId = undefined;
        }
      }
    }
    if (!chatId) {
      return new Response(
        JSON.stringify({ ok: true, envelopes: 0, dropped: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const result = normalizeHookEvent(body, chatId);
    if (result.pendingGate) {
      store.pendingGates.upsert(result.pendingGate);
    }
    if (result.clearGates) {
      store.pendingGates.deleteByChat(result.clearGates.chatId);
    }
    if (result.warning) {
      lastWarnings.push(result.warning);
      console.warn(`[loom hook] ${result.warning}`);
    }
    if (broadcaster) {
      for (const env of result.envelopes) broadcaster(env);
    }
    return new Response(JSON.stringify({ ok: true, envelopes: result.envelopes.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
