/**
 * POST /chats/rename?id=<chatId> (US-006).
 *
 * Drives the rename route handler against a seeded chat, exercising the
 * validation matrix from design.md (State and error handling) plus the
 * 80-char trim/length cap from ADR-6.
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

function jsonPost(id: string | null, body: unknown, raw?: string): Request {
  const url = id === null
    ? "http://localhost/chats/rename"
    : `http://localhost/chats/rename?id=${encodeURIComponent(id)}`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  init.body = raw !== undefined ? raw : JSON.stringify(body);
  return new Request(url, init);
}

describe("POST /chats/rename", () => {
  test("trims whitespace and persists custom_name (acc 1)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    expect(routes["/chats/rename"]).toBeDefined();
    const req = jsonPost(chat.id, { customName: "  foo  " });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.custom_name).toBe("foo");
    expect(store.chats.get(chat.id)?.custom_name).toBe("foo");
    await store.close();
  });

  test("rejects trimmed length 81 with 400 and leaves row unchanged (acc 2)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    store.chats.setCustomName(chat.id, "Previous");
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, { customName: "x".repeat(81) });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too long/i);
    expect(store.chats.get(chat.id)?.custom_name).toBe("Previous");
    await store.close();
  });

  test("accepts trimmed length 80 boundary (acc 2)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const exactly80 = "x".repeat(80);
    const req = jsonPost(chat.id, { customName: exactly80 });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.custom_name).toBe(exactly80);
    await store.close();
  });

  test("null clears custom_name (acc 3)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    store.chats.setCustomName(chat.id, "Previous");
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, { customName: null });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.custom_name).toBeNull();
    expect(store.chats.get(chat.id)?.custom_name).toBeNull();
    await store.close();
  });

  test("whitespace-only string clears custom_name (acc 3)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    store.chats.setCustomName(chat.id, "Previous");
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, { customName: "   " });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.custom_name).toBeNull();
    expect(store.chats.get(chat.id)?.custom_name).toBeNull();
    await store.close();
  });

  test("unknown chat id responds 404 with JSON error (acc 4)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost("does-not-exist", { customName: "foo" });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("chat not found");
    await store.close();
  });

  test("missing id query param responds 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(null, { customName: "foo" });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing id");
    await store.close();
  });

  test("non-JSON body responds 400 invalid body", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, undefined, "not json {{{");
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid body");
    await store.close();
  });

  test("non-string non-null customName responds 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, { customName: 42 });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid customName");
    await store.close();
  });

  test("success response body is decorated (includes auto_title)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    store.chatItems.append(chat.id, {
      kind: "user-message",
      id: "u1",
      turnId: "t-1",
      text: "hello world",
      createdAt: new Date().toISOString(),
    });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = jsonPost(chat.id, { customName: "Renamed" });
    const res = await routes["/chats/rename"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat).toHaveProperty("auto_title");
    expect(body.chat.auto_title).toBe("hello world");
    expect(body.chat.custom_name).toBe("Renamed");
    await store.close();
  });
});
