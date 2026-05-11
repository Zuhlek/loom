/**
 * Tests for /chats POST + GET. Exercises the in-process route handler
 * directly (no HTTP) so we don't need to bind a port.
 */
import { describe, test, expect } from "bun:test";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

describe("chats route", () => {
  test("POST /chats creates and persists a chat row", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const handler = routes["/chats"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/repo", permissionMode: "default", projectName: "alpha" }),
    });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.cwd).toBe("/tmp/repo");
    expect(body.chat.id).toBeTruthy();
    // Project was auto-created.
    expect(store.projects.getByName("alpha")?.paths).toContain("/tmp/repo");
    await store.close();
  });

  test("POST /chats requires cwd", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });

  test("POST /chats with projectId attaches chat to existing project", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/repo"] });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/repo", projectId: proj.id }),
    });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.project_id).toBe(proj.id);
    await store.close();
  });

  test("POST /chats with projectId rejects cwd outside project.paths with 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/a"] });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/b", projectId: proj.id }),
    });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("project's declared paths");
    // Project paths unchanged.
    expect(store.projects.get(proj.id)?.paths).toEqual(["/tmp/a"]);
    await store.close();
  });

  test("POST /chats with unknown projectId returns 404", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/repo", projectId: "ghost" }),
    });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(404);
    await store.close();
  });

  test("POST /chats without projectId or projectName lands in Unassigned", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/repo" }),
    });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chat.project_id).toBeNull();
    await store.close();
  });

  test("GET /chats lists chats", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd: "/tmp/a" });
    store.chats.create({ id: "c2", cwd: "/tmp/b" });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats", { method: "GET" });
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chats.length).toBe(2);
    await store.close();
  });

  test("DELETE /chats/delete removes the row and disposes the PTY", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd: "/tmp/a" });
    let disposed: string | null = null;
    const fakeBridge: any = {
      dispose(id: string) {
        disposed = id;
      },
    };
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store, fakeBridge);
    const handler = routes["/chats/delete"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/chats/delete?id=c1", { method: "DELETE" });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(204);
    expect(disposed).toBe("c1");
    expect(store.chats.get("c1")).toBeNull();
    await store.close();
  });

  test("DELETE /chats/delete missing id returns 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats/delete", { method: "DELETE" });
    const res = await routes["/chats/delete"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });

  test("DELETE /chats/delete unknown id returns 404", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats/delete?id=ghost", { method: "DELETE" });
    const res = await routes["/chats/delete"](req, new URL(req.url));
    expect(res.status).toBe(404);
    await store.close();
  });
});
