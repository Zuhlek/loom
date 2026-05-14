/**
 * Tests for the fabric archive surface (/fabric/archive, /unarchive,
 * /archived) and the sidebar's exclusion of archived rows.
 */
import { describe, test, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountFabricArchiveRoute } from "../src/routes/fabric-archive.ts";
import { mountSidebarRoute, invalidateFabricCache, fabricId } from "../src/routes/sidebar.ts";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const r of tmpRoots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {}
  }
});

function makeProject(fabricNames: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-archive-test-"));
  tmpRoots.push(root);
  fs.mkdirSync(path.join(root, ".loom"), { recursive: true });
  for (const n of fabricNames) {
    fs.mkdirSync(path.join(root, ".loom", n), { recursive: true });
  }
  return root;
}

describe("fabric archive routes", () => {
  test("POST /fabric/archive stores the row and /archived lists it", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricArchiveRoute(routes, store);

    const archiveReq = new Request("http://localhost/fabric/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "p1__alpha__abcd1234",
        projectId: "p1",
        fabricName: "alpha",
        cwd: "/tmp/proj",
      }),
    });
    const archiveRes = await routes["/fabric/archive"](archiveReq, new URL(archiveReq.url));
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()).archived;
    expect(archived.id).toBe("p1__alpha__abcd1234");
    expect(archived.fabricName).toBe("alpha");

    const listReq = new Request("http://localhost/fabric/archived", { method: "GET" });
    const listRes = await routes["/fabric/archived"](listReq, new URL(listReq.url));
    const list = (await listRes.json()).archived;
    expect(list.length).toBe(1);
    expect(list[0].fabricName).toBe("alpha");
    await store.close();
  });

  test("POST /fabric/unarchive removes the row", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricArchiveRoute(routes, store);
    store.archivedFabrics.archive({ id: "p1__beta__deadbeef", projectId: "p1", fabricName: "beta", cwd: "/tmp/proj" });

    const req = new Request("http://localhost/fabric/unarchive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "p1__beta__deadbeef" }),
    });
    const res = await routes["/fabric/unarchive"](req, new URL(req.url));
    expect(res.status).toBe(200);
    expect(store.archivedFabrics.list()).toEqual([]);
    await store.close();
  });

  test("archive validates required fields", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricArchiveRoute(routes, store);
    const req = new Request("http://localhost/fabric/archive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", projectId: "p1" }),
    });
    const res = await routes["/fabric/archive"](req, new URL(req.url));
    expect(res.status).toBe(400);
    await store.close();
  });

  test("sidebar excludes archived fabrics from the per-project list", async () => {
    invalidateFabricCache();
    const root = makeProject(["foo", "bar"]);
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: [root] });
    const routes: Record<string, any> = {};
    mountSidebarRoute(routes, store);

    // Pre-archive: both fabrics surfaced.
    const before = await (await routes["/sidebar/state"](new Request("http://localhost/sidebar/state"), new URL("http://localhost/sidebar/state"))).json();
    expect(before.groups[0].fabrics.map((f: any) => f.name).sort()).toEqual(["bar", "foo"]);

    // Archive "foo" using the stable id formula the sidebar uses.
    const id = fabricId(proj.id, "foo", root);
    store.archivedFabrics.archive({ id, projectId: proj.id, fabricName: "foo", cwd: root });
    invalidateFabricCache();

    const after = await (await routes["/sidebar/state"](new Request("http://localhost/sidebar/state"), new URL("http://localhost/sidebar/state"))).json();
    expect(after.groups[0].fabrics.map((f: any) => f.name)).toEqual(["bar"]);
    await store.close();
  });
});
