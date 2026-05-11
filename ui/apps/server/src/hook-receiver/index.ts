/**
 * POST /hooks/event — Claude Code's user-scope hooks call this.
 *
 * Origin-checked at the server layer. Normalizes each event into a
 * chat-protocol envelope, persists pending-gate rows when the channel
 * indicates AskUserQuestion or PermissionRequest, and clears them on
 * Stop / SubagentStop.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import { normalizeHookEvent, type HookEvent } from "./normalize.ts";

export type EnvelopeBroadcaster = (envelope: any) => void;

let broadcaster: EnvelopeBroadcaster | null = null;
const lastWarnings: string[] = [];

export function setEnvelopeBroadcaster(b: EnvelopeBroadcaster | null) {
  broadcaster = b;
}

export function getRecentHookWarnings(): string[] {
  return lastWarnings.slice(-50);
}

export function mountHookReceiver(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/hooks/event"] = async (req: Request) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    let body: HookEvent;
    try {
      body = (await req.json()) as HookEvent;
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    if (!body || typeof body.channel !== "string") {
      return new Response("missing channel", { status: 400 });
    }
    const result = normalizeHookEvent(body);
    if (result.pendingGate) {
      store.pendingGates.upsert(result.pendingGate);
    }
    if (result.clearGates) {
      store.pendingGates.deleteByChat(result.clearGates.chatId);
    }
    if (result.warning) {
      lastWarnings.push(result.warning);
      console.warn(`[nora hook] ${result.warning}`);
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
