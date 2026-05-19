/**
 * T-008 — POST /chats/fork?id=<chatId> (US-003).
 *
 * Drives the route handler against a seeded chat row, asserting the
 * clone copies the documented fields and resets the per-spawn ones.
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

describe("T-008 POST /chats/fork", () => {
  test("returns 404 for an unknown chat id", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    expect(routes["/chats/fork"]).toBeDefined();
    const req = new Request("http://localhost/chats/fork?id=does-not-exist", { method: "POST" });
    const res = await routes["/chats/fork"](req, new URL(req.url));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    await store.close();
  });

  test("returns 200 + a fresh ApiChat on the happy path; copies cwd, permission_mode, worktree_mode, project_id", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/repo"] });
    const src = store.chats.create({
      id: "c1",
      cwd: "/tmp/repo",
      project_id: proj.id,
      permission_mode: "accept-edits",
      worktree_mode: "worktree",
    });
    // Source row has a session_id and a pid simulating a live spawn.
    store.chats.setPid(src.id, 4242);

    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request(`http://localhost/chats/fork?id=${src.id}`, { method: "POST" });
    const res = await routes["/chats/fork"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    const forked = body.chat;
    expect(forked).toBeDefined();
    expect(forked.id).not.toBe(src.id);
    expect(forked.cwd).toBe(src.cwd);
    expect(forked.permission_mode).toBe("accept-edits");
    expect(forked.worktree_mode).toBe("worktree");
    expect(forked.project_id).toBe(proj.id);
    // Per-spawn fields are NOT copied.
    expect(forked.session_id).not.toBe(src.session_id);
    expect(forked.pid).toBeNull();
    expect(forked.inert).toBe(false);

    // Source chat is unaffected.
    const reloadedSrc = store.chats.get(src.id);
    expect(reloadedSrc?.pid).toBe(4242);
    await store.close();
  });

  test("rejects non-POST methods", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats/fork?id=x", { method: "GET" });
    const res = await routes["/chats/fork"](req, new URL(req.url));
    expect(res.status).toBe(405);
    await store.close();
  });

  test("forked chat is decorated and drops the source's custom_name to null", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const src = store.chats.create({ id: "c-src", cwd: "/tmp/repo" });
    store.chats.setCustomName(src.id, "Renamed");
    store.chatItems.append(src.id, {
      kind: "user-message",
      id: "u1",
      turnId: "t-1",
      text: "source prompt",
      createdAt: new Date().toISOString(),
    });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request(`http://localhost/chats/fork?id=${src.id}`, { method: "POST" });
    const res = await routes["/chats/fork"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat).toHaveProperty("custom_name");
    expect(body.chat).toHaveProperty("auto_title");
    expect(body.chat.custom_name).toBeNull();
    expect(body.chat.auto_title).toBeNull();
    await store.close();
  });
});
