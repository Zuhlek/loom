/**
 * T-007 — POST /chats/handoff?id=<chatId> (US-003).
 *
 * Drives the route handler with stubbed bridge + launcher across the
 * 4 documented response codes (200/404/409/500).
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

/** Make a minimal bridge stub that satisfies the handoff route. */
function makeBridge(hasSessionFor: string[] = []) {
  const sessions = new Set(hasSessionFor);
  return {
    hasSession: (id: string) => sessions.has(id),
    dispose: () => {},
    getSessionInfo: (id: string) =>
      sessions.has(id) ? { chatId: id, port: 4123 } : null,
  } as any;
}

describe("T-007 POST /chats/handoff", () => {
  test("returns 404 for an unknown chat id", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store, makeBridge(), {
      launchHandoffTerminal: async () => ({ ok: true, launched: { command: "x", pid: 1 } }),
    });
    expect(routes["/chats/handoff"]).toBeDefined();
    const req = new Request("http://localhost/chats/handoff?id=does-not-exist", { method: "POST" });
    const res = await routes["/chats/handoff"](req, new URL(req.url));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    await store.close();
  });

  test("returns 409 when the chat exists but has no live bridge session", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store, makeBridge(/* no sessions */), {
      launchHandoffTerminal: async () => ({ ok: true, launched: { command: "x", pid: 1 } }),
    });
    const req = new Request(`http://localhost/chats/handoff?id=${chat.id}`, { method: "POST" });
    const res = await routes["/chats/handoff"](req, new URL(req.url));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/no live session/i);
    await store.close();
  });

  test("returns 200 + { ok, command } on the happy path; does NOT dispose the PTY", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c2", cwd: "/tmp/repo" });
    const bridge = makeBridge([chat.id]);
    let disposed = false;
    bridge.dispose = () => {
      disposed = true;
    };
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store, bridge, {
      launchHandoffTerminal: async () => ({
        ok: true,
        launched: { command: "open -a Terminal.app", pid: 4711 },
      }),
    });
    const req = new Request(`http://localhost/chats/handoff?id=${chat.id}`, { method: "POST" });
    const res = await routes["/chats/handoff"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.command).toBe("string");
    expect(disposed).toBe(false);
    await store.close();
  });

  test("returns 500 when the launcher reports { ok: false, error }", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c3", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store, makeBridge([chat.id]), {
      launchHandoffTerminal: async () => ({ ok: false, error: "no terminal found" }),
    });
    const req = new Request(`http://localhost/chats/handoff?id=${chat.id}`, { method: "POST" });
    const res = await routes["/chats/handoff"](req, new URL(req.url));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/no terminal/i);
    await store.close();
  });
});
