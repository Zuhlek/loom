/**
 * Tests for /sidebar/state fabric auto-discovery.
 */
import { describe, test, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountSidebarRoute, invalidateFabricCache } from "../src/routes/sidebar.ts";
import type { UserMessageItem } from "../src/chat-protocol/messages.ts";

function makeUserItem(id: string, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id,
    turnId: "t-1",
    text,
    createdAt: new Date().toISOString(),
  };
}

const tmpRoots: string[] = [];

afterAll(() => {
  for (const r of tmpRoots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {}
  }
});

function makeProjectWithFabrics(fabricNames: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-test-"));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, ".loom"), { recursive: true });
  for (const n of fabricNames) {
    fs.mkdirSync(path.join(root, ".loom", n), { recursive: true });
  }
  return root;
}

describe("sidebar route fabric discovery", () => {
  test("GET /sidebar/state lists .loom/<name>/ entries per project path", async () => {
    invalidateFabricCache();
    const root = makeProjectWithFabrics(["foo", "bar"]);
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.length).toBe(1);
    const fabrics = body.groups[0].fabrics;
    expect(fabrics.length).toBe(2);
    const names = fabrics.map((f: any) => f.name).sort();
    expect(names).toEqual(["bar", "foo"]);
    for (const f of fabrics) {
      expect(f.projectId).toBe(proj.id);
      expect(f.projectName).toBe("alpha");
      expect(f.cwd).toBe(root);
      expect(f.dotLoomPath).toBe(path.join(root, ".loom", f.name));
      expect(f.id).toMatch(/^[\w-]+__[\w-]+__[a-f0-9]{8}$/);
    }
    await store.close();
  });

  test("fabric discovery skips dot-prefixed entries and non-directories", async () => {
    invalidateFabricCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-test-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, ".loom", "real"), { recursive: true });
    fs.mkdirSync(path.join(root, ".loom", ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(root, ".loom", "not-a-dir.txt"), "ignore me");

    const store = await initMetadataStore({ inMemoryOnly: true });
    store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    const fabrics = body.groups[0].fabrics;
    expect(fabrics.map((f: any) => f.name)).toEqual(["real"]);
    await store.close();
  });

  test("grouped chat with a non-empty user-message exposes auto_title", async () => {
    invalidateFabricCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/a"] });
    const chat = store.chats.create({ id: "c-grouped", cwd: "/tmp/a", project_id: proj.id });
    store.chatItems.append(chat.id, makeUserItem("u1", "hello sidebar"));
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    const grouped = body.groups[0].chats[0];
    expect(grouped.id).toBe("c-grouped");
    expect(grouped.custom_name).toBeNull();
    expect(grouped.auto_title).toBe("hello sidebar");
    await store.close();
  });

  test("bridge live state is surfaced onto decorated chats", async () => {
    invalidateFabricCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/a"] });
    store.chats.create({ id: "c-busy", cwd: "/tmp/a", project_id: proj.id });
    store.chats.create({ id: "c-idle", cwd: "/tmp/a", project_id: proj.id });
    const bridge: any = {
      getLiveState: (id: string) =>
        id === "c-busy" ? { turnState: "running", needsInput: false } : null,
    };
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store, bridge);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    const chats: any[] = body.groups[0].chats;
    const busy = chats.find((c) => c.id === "c-busy");
    const idle = chats.find((c) => c.id === "c-idle");
    expect(busy.live).toEqual({ turnState: "running", needsInput: false });
    expect(idle.live).toBeNull();
    await store.close();
  });

  test("grouped chat with empty chatItems exposes auto_title null", async () => {
    invalidateFabricCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/a"] });
    store.chats.create({ id: "c-empty", cwd: "/tmp/a", project_id: proj.id });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    const grouped = body.groups[0].chats[0];
    expect(grouped.id).toBe("c-empty");
    expect("custom_name" in grouped).toBe(true);
    expect("auto_title" in grouped).toBe(true);
    expect(grouped.custom_name).toBeNull();
    expect(grouped.auto_title).toBeNull();
    await store.close();
  });

  test("unassigned chat is decorated with custom_name and auto_title", async () => {
    invalidateFabricCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-unassigned", cwd: "/tmp/orphan" });
    store.chatItems.append(chat.id, makeUserItem("u1", "first prompt here"));
    store.chats.setCustomName(chat.id, "Pinned chat");
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    expect(body.unassigned.length).toBe(1);
    const orphan = body.unassigned[0];
    expect(orphan.id).toBe("c-unassigned");
    expect(orphan.project_id).toBeNull();
    expect(orphan.custom_name).toBe("Pinned chat");
    expect(orphan.auto_title).toBe("first prompt here");
    await store.close();
  });

  test("every grouped and unassigned chat carries custom_name and auto_title keys", async () => {
    invalidateFabricCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: ["/tmp/a"] });
    store.chats.create({ id: "g1", cwd: "/tmp/a", project_id: proj.id });
    const g2 = store.chats.create({ id: "g2", cwd: "/tmp/a", project_id: proj.id });
    store.chatItems.append(g2.id, makeUserItem("u-g2", "second"));
    store.chats.create({ id: "u1", cwd: "/tmp/x" });
    const u2 = store.chats.create({ id: "u2", cwd: "/tmp/y" });
    store.chatItems.append(u2.id, makeUserItem("u-u2", "another"));
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    const all = [...body.groups.flatMap((g: any) => g.chats), ...body.unassigned];
    expect(all.length).toBe(4);
    for (const chat of all) {
      expect("custom_name" in chat).toBe(true);
      expect("auto_title" in chat).toBe(true);
    }
    await store.close();
  });

  test("project with no .loom/ directory yields zero fabrics", async () => {
    invalidateFabricCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-test-"));
    tmpRoots.push(root);

    const store = await initMetadataStore({ inMemoryOnly: true });
    store.projects.create({ name: "nofabric", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    expect(body.groups[0].fabrics).toEqual([]);
    await store.close();
  });
});
