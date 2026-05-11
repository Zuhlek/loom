/**
 * Tests for the cwd browser routes used by the picker UI.
 */
import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountCwdRoute } from "../src/routes/cwd.ts";

describe("cwd routes", () => {
  test("GET /cwd?parent=~ returns directories under HOME", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    const handler = routes["/cwd"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/cwd?parent=~");
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent).toBe(os.homedir());
    expect(Array.isArray(body.entries)).toBe(true);
    for (const e of body.entries) {
      expect(e.isDirectory).toBe(true);
      expect(e.path.startsWith(os.homedir())).toBe(true);
      expect(e.name.startsWith(".")).toBe(false);
    }
    await store.close();
  });

  test("GET /cwd?parent=/etc rejects outside HOME", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    const req = new Request("http://localhost/cwd?parent=/etc");
    const res = await routes["/cwd"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });

  test("GET /cwd marks hasGit on directories with a .git", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    // Create a tiny git-shaped tree under HOME's tmp area.
    const tmpRoot = fs.mkdtempSync(path.join(os.homedir(), ".loom-cwd-test-"));
    try {
      const repo = path.join(tmpRoot, "repo-a");
      fs.mkdirSync(repo);
      fs.mkdirSync(path.join(repo, ".git"));
      fs.mkdirSync(path.join(tmpRoot, "plain-b"));
      const req = new Request(`http://localhost/cwd?parent=${encodeURIComponent(tmpRoot)}`);
      const res = await routes["/cwd"](req, new URL(req.url));
      expect(res.status).toBe(200);
      const body = await res.json();
      const repoEntry = body.entries.find((e: any) => e.name === "repo-a");
      const plainEntry = body.entries.find((e: any) => e.name === "plain-b");
      expect(repoEntry?.hasGit).toBe(true);
      expect(plainEntry?.hasGit).toBe(false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      await store.close();
    }
  });

  test("GET /cwd?parent=<nonexistent under HOME> returns 404", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    // A path inside HOME that almost certainly doesn't exist.
    const ghost = path.join(os.homedir(), ".loom-does-not-exist-" + Date.now());
    const req = new Request(`http://localhost/cwd?parent=${encodeURIComponent(ghost)}`);
    const res = await routes["/cwd"](req, new URL(req.url));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("directory not found");
    expect(body.path).toBe(ghost);
    await store.close();
  });

  test("GET /cwd?parent=<file under HOME> returns 404 (ENOTDIR)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    const filePath = path.join(os.homedir(), ".loom-cwd-test-file-" + Date.now());
    fs.writeFileSync(filePath, "x");
    try {
      const req = new Request(`http://localhost/cwd?parent=${encodeURIComponent(filePath)}`);
      const res = await routes["/cwd"](req, new URL(req.url));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("directory not found");
    } finally {
      fs.rmSync(filePath, { force: true });
      await store.close();
    }
  });

  test("GET /cwd/roots includes HOME", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountCwdRoute(routes, store);
    const handler = routes["/cwd/roots"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/cwd/roots");
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.home).toBe(os.homedir());
    expect(Array.isArray(body.roots)).toBe(true);
    expect(body.roots.length).toBeGreaterThanOrEqual(1);
    const homeRoot = body.roots.find((r: any) => r.path === os.homedir());
    expect(homeRoot).toBeDefined();
    await store.close();
  });
});
