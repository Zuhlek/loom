/**
 * Tests for /projects POST + GET. Exercises the in-process route handler
 * directly (no HTTP).
 */
import { describe, test, expect } from "bun:test";
import * as os from "node:os";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountProjectsRoute } from "../src/routes/projects.ts";

const HOME = os.homedir();

describe("projects route", () => {
  test("POST /projects creates a project with initialCwd", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const handler = routes["/projects"];
    const req = new Request("http://localhost/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha", initialCwd: HOME }),
    });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project.name).toBe("alpha");
    expect(body.project.paths).toEqual([HOME]);
    expect(store.projects.getByName("alpha")?.id).toBe(body.project.id);
    await store.close();
  });

  test("POST /projects rejects empty name", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", initialCwd: HOME }),
    });
    const res = await routes["/projects"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });

  test("POST /projects rejects nonexistent cwd", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ghost", initialCwd: "/this/path/does/not/exist/anywhere" }),
    });
    const res = await routes["/projects"](req, new URL(req.url));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not exist");
    await store.close();
  });

  test("POST /projects rejects duplicate name with 409", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.projects.create({ name: "dup", paths: [HOME] });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "dup", initialCwd: HOME }),
    });
    const res = await routes["/projects"](req, new URL(req.url));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.project?.name).toBe("dup");
    await store.close();
  });

  test("GET /projects lists projects", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.projects.create({ name: "a", paths: ["/x"] });
    store.projects.create({ name: "b", paths: ["/y"] });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects", { method: "GET" });
    const res = await routes["/projects"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects.length).toBe(2);
    await store.close();
  });

  test("DELETE /projects/delete cascades to its chats and disposes PTYs", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/x"] });
    store.chats.create({ id: "c1", project_id: proj.id, cwd: "/x" });
    store.chats.create({ id: "c2", project_id: proj.id, cwd: "/x" });
    // A chat in another project should NOT be touched.
    const otherProj = store.projects.create({ name: "other", paths: ["/y"] });
    store.chats.create({ id: "c3", project_id: otherProj.id, cwd: "/y" });

    const disposed: string[] = [];
    const fakeBridge: any = {
      dispose(id: string) {
        disposed.push(id);
      },
    };
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store, fakeBridge);
    const req = new Request(`http://localhost/projects/delete?id=${proj.id}`, { method: "DELETE" });
    const res = await routes["/projects/delete"](req, new URL(req.url));
    expect(res.status).toBe(204);
    expect(store.projects.get(proj.id)).toBeNull();
    expect(store.chats.get("c1")).toBeNull();
    expect(store.chats.get("c2")).toBeNull();
    expect(store.chats.get("c3")).not.toBeNull();
    expect(disposed.sort()).toEqual(["c1", "c2"]);
    await store.close();
  });

  test("DELETE /projects/delete with no chats succeeds with 204", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "empty", paths: ["/x"] });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request(`http://localhost/projects/delete?id=${proj.id}`, { method: "DELETE" });
    const res = await routes["/projects/delete"](req, new URL(req.url));
    expect(res.status).toBe(204);
    expect(store.projects.get(proj.id)).toBeNull();
    await store.close();
  });

  test("DELETE /projects/delete unknown id returns 404", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects/delete?id=ghost", { method: "DELETE" });
    const res = await routes["/projects/delete"](req, new URL(req.url));
    expect(res.status).toBe(404);
    await store.close();
  });

  test("DELETE /projects/delete missing id returns 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountProjectsRoute(routes, store);
    const req = new Request("http://localhost/projects/delete", { method: "DELETE" });
    const res = await routes["/projects/delete"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });
});
