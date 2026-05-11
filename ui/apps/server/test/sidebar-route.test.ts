/**
 * Tests for /sidebar/state loom auto-discovery.
 */
import { describe, test, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountSidebarRoute, invalidateLoomCache } from "../src/routes/sidebar.ts";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const r of tmpRoots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {}
  }
});

function makeProjectWithLooms(loomNames: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-loom-"));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, ".loom"), { recursive: true });
  for (const n of loomNames) {
    fs.mkdirSync(path.join(root, ".loom", n), { recursive: true });
  }
  return root;
}

describe("sidebar route loom discovery", () => {
  test("GET /sidebar/state lists .loom/<name>/ entries per project path", async () => {
    invalidateLoomCache();
    const root = makeProjectWithLooms(["foo", "bar"]);
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.length).toBe(1);
    const looms = body.groups[0].looms;
    expect(looms.length).toBe(2);
    const names = looms.map((f: any) => f.name).sort();
    expect(names).toEqual(["bar", "foo"]);
    for (const f of looms) {
      expect(f.projectId).toBe(proj.id);
      expect(f.projectName).toBe("alpha");
      expect(f.cwd).toBe(root);
      expect(f.dotLoomPath).toBe(path.join(root, ".loom", f.name));
      expect(f.id).toMatch(/^[\w-]+__[\w-]+__[a-f0-9]{8}$/);
    }
    await store.close();
  });

  test("loom discovery skips dot-prefixed entries and non-directories", async () => {
    invalidateLoomCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-loom-"));
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
    const looms = body.groups[0].looms;
    expect(looms.map((f: any) => f.name)).toEqual(["real"]);
    await store.close();
  });

  test("project with no .loom/ directory yields zero looms", async () => {
    invalidateLoomCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nora-loom-"));
    tmpRoots.push(root);

    const store = await initMetadataStore({ inMemoryOnly: true });
    store.projects.create({ name: "noloom", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);
    const req = new Request("http://localhost/sidebar/state", { method: "GET" });
    const res = await routes["/sidebar/state"](req, new URL(req.url));
    const body = await res.json();
    expect(body.groups[0].looms).toEqual([]);
    await store.close();
  });
});
