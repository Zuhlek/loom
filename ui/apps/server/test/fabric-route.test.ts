/**
 * Tests for /fabric/:projectId/:fabricName.
 *
 * Seeds a temp project containing `.loom/foo/` with a `pipeline.md`
 * file (the markdown format written by
 * `orchestrator/lib/pipeline-parser.py`) and a `spec.md`; calls the
 * registered handler directly and verifies the parsed pipeline +
 * artifact content come back.
 */
import { describe, test, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountFabricRoute, invalidateFabricViewCache } from "../src/routes/fabric.ts";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const r of tmpRoots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {}
  }
});

function makeFabric(fabricName: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-route-test-"));
  tmpRoots.push(root);
  const loomDir = path.join(root, ".loom", fabricName);
  fs.mkdirSync(loomDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(loomDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  return root;
}

describe("fabric route", () => {
  test("GET /fabric/:projectId/:fabricName returns pipeline + spec.md content", async () => {
    invalidateFabricViewCache();
    const root = makeFabric("foo", {
      "pipeline.md": [
        "# Pipeline - foo",
        "",
        "## Project name",
        "```text",
        "foo",
        "```",
        "",
        "## Current phase",
        "```text",
        "build",
        "```",
        "",
        "## Phase status",
        "```text",
        "Pending",
        "```",
        "",
        "## Lifecycle state",
        "```text",
        "active",
        "```",
        "",
      ].join("\n"),
      "spec.md": "# Spec\n\nthis is the spec body",
      "mockup/01-foo.html": "<html><body>foo</body></html>",
    });

    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "alpha", paths: [root] });

    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);

    const handler = routes["/fabric/:projectId/:fabricName"];
    expect(typeof handler).toBe("function");

    const url = new URL(`http://localhost/fabric/${proj.id}/foo`);
    const req = new Request(url, { method: "GET" });
    const res = await handler(req, url);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.projectId).toBe(proj.id);
    expect(body.fabricName).toBe("foo");
    expect(body.pipeline.current.phase).toBe("build");
    expect(body.pipeline.current.status).toBe("Pending");

    expect(body.artifacts["spec.md"]).toContain("this is the spec body");
    expect(body.artifacts["pipeline.md"]).toContain("Current phase");

    expect(Array.isArray(body.tree)).toBe(true);
    const treeNames = body.tree.map((t: any) => t.name);
    expect(treeNames).toContain("spec.md");
    expect(treeNames).toContain("pipeline.md");
    expect(treeNames).toContain("mockup");

    expect(body.events).toBeUndefined();

    expect(body.mockupPages).toEqual(["01-foo.html"]);

    await store.close();
  });

  test("404 on missing project", async () => {
    invalidateFabricViewCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL("http://localhost/fabric/missing-id/foo");
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(404);
    await store.close();
  });

  test("404 on missing fabric directory", async () => {
    invalidateFabricViewCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-route-test-"));
    tmpRoots.push(root);
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL(`http://localhost/fabric/${proj.id}/nope`);
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(404);
    await store.close();
  });

  test("rejects path-traversal fabric names", async () => {
    invalidateFabricViewCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({
      name: "p",
      paths: [fs.mkdtempSync(path.join(os.tmpdir(), "fabric-route-test-"))],
    });
    tmpRoots.push(proj.paths[0]);
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    // The encoded `..` survives URL parsing; the handler must reject it.
    const url = new URL(
      `http://localhost/fabric/${proj.id}/${encodeURIComponent("../etc")}`,
    );
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(400);
    await store.close();
  });

  test("artifacts map includes .json files", async () => {
    invalidateFabricViewCache();
    const root = makeFabric("ext-json", {
      "config.json": '{"hello": "world"}',
    });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL(`http://localhost/fabric/${proj.id}/ext-json`);
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifacts["config.json"]).toBe('{"hello": "world"}');
    await store.close();
  });

  test("artifacts map includes .txt files", async () => {
    invalidateFabricViewCache();
    const root = makeFabric("ext-txt", {
      "notes.txt": "plain text content\nsecond line",
    });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL(`http://localhost/fabric/${proj.id}/ext-txt`);
    const res = await handler(new Request(url), url);
    const body = await res.json();
    expect(body.artifacts["notes.txt"]).toBe("plain text content\nsecond line");
    await store.close();
  });

  test("artifacts map excludes non-allowlisted extensions", async () => {
    invalidateFabricViewCache();
    const root = makeFabric("ext-skip", {
      "run.sh": "#!/bin/bash\necho hi",
      "spec.md": "# kept",
    });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL(`http://localhost/fabric/${proj.id}/ext-skip`);
    const res = await handler(new Request(url), url);
    const body = await res.json();
    const treeNames = body.tree.map((t: any) => t.name);
    expect(treeNames).toContain("run.sh");
    expect(body.artifacts["run.sh"]).toBeUndefined();
    expect(body.artifacts["spec.md"]).toContain("kept");
    await store.close();
  });

  test("oversize .json artifact carries truncation marker", async () => {
    invalidateFabricViewCache();
    const big = "x".repeat(250 * 1024);
    const root = makeFabric("ext-big", {
      "big.json": big,
    });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL(`http://localhost/fabric/${proj.id}/ext-big`);
    const res = await handler(new Request(url), url);
    const body = await res.json();
    expect(body.artifacts["big.json"]).toMatch(/truncated at/);
    await store.close();
  });

  test("non-GET method returns 405", async () => {
    invalidateFabricViewCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const url = new URL("http://localhost/fabric/anything/foo");
    const res = await handler(new Request(url, { method: "POST" }), url);
    expect(res.status).toBe(405);
    await store.close();
  });

  test("caches result within 1s window", async () => {
    invalidateFabricViewCache();
    const root = makeFabric("c1", { "spec.md": "first" });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];

    const url = new URL(`http://localhost/fabric/${proj.id}/c1`);
    const r1 = await handler(new Request(url), url);
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.artifacts["spec.md"]).toBe("first");

    // Mutate on disk; within 1s the cache should still serve the old.
    fs.writeFileSync(path.join(root, ".loom", "c1", "spec.md"), "second", "utf8");
    const r2 = await handler(new Request(url), url);
    const b2 = await r2.json();
    expect(b2.artifacts["spec.md"]).toBe("first");

    await store.close();
  });
});
