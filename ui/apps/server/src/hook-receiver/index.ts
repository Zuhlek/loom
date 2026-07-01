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
import type {
  GateResolution,
  PermissionGate,
} from "./permission-gate.ts";
import { traceHook } from "./trace.ts";

export type EnvelopeBroadcaster = (envelope: any) => void;

let broadcaster: EnvelopeBroadcaster | null = null;
let lastDelivered: { channel: string; at: string } | null = null;

export function setEnvelopeBroadcaster(b: EnvelopeBroadcaster | null) {
  broadcaster = b;
}

export function getLastDelivered(): { channel: string; at: string } | null {
  return lastDelivered;
}

/** Build the PreToolUse hook stdout claude reads to decide allow/deny/ask/defer. */
function preToolUseDecisionBody(resolution: GateResolution): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: resolution.decision,
      ...(resolution.reason
        ? { permissionDecisionReason: resolution.reason }
        : {}),
    },
  });
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function mountHookReceiver(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
  sessionStore?: SessionIdStore,
  permissionGate?: PermissionGate,
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

    traceHook("inbound", {
      channel,
      tool_name: (body as { tool_name?: unknown }).tool_name,
      session_id: body.session_id,
      body,
    });

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
      // Release any held PreToolUse curls for this chat — the turn ended, so
      // an unanswered popup is moot. `defer` lets claude finish cleanly.
      permissionGate?.rejectAll(result.clearGates.chatId, {
        decision: "defer",
        reason: "Loom: turn ended before the permission request was answered.",
      });
    }
    if (result.warning) {
      console.warn(`[loom hook] ${result.warning}`);
    }

    // Gated PreToolUse: hold the hook's HTTP response open until the UI
    // answers (or the gate auto-denies on timeout), then hand claude the
    // resulting permissionDecision. The held curl keeps the agent blocked —
    // this is what makes the web popup an authoritative gate rather than a
    // passive mirror. Without a gate wired (older callers / tests) we cannot
    // block, so fall through to the immediate-ack path (claude defers).
    //
    // Register BEFORE broadcasting the popup so the gate exists no matter how
    // the broadcaster schedules its WS sends — the answer can only arrive on
    // a later event-loop turn, never before the entry is in place.
    if (result.gate && permissionGate) {
      const pending = permissionGate.register(result.gate.chatId, result.gate.id);
      if (broadcaster) for (const env of result.envelopes) broadcaster(env);
      const resolution = await pending;
      return jsonResponse(preToolUseDecisionBody(resolution));
    }

    if (broadcaster) {
      for (const env of result.envelopes) broadcaster(env);
    }
    return jsonResponse(
      JSON.stringify({ ok: true, envelopes: result.envelopes.length }),
    );
  };
}
