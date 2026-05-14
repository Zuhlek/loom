/**
 * Tests for /loom/:projectId/:loomName.
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
import { mountLoomRoute, invalidateLoomViewCache } from "../src/routes/loom.ts";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const r of tmpRoots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {}
  }
});

function makeLoom(loomName: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-route-test-"));
  tmpRoots.push(root);
  const loomDir = path.join(root, ".loom", loomName);
  fs.mkdirSync(loomDir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(loomDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf8");
  }
  return root;
}

describe("loom route", () => {
  test("GET /loom/:projectId/:loomName returns pipeline + spec.md content", async () => {
    invalidateLoomViewCache();
    const root = makeLoom("foo", {
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
    mountLoomRoute(routes, store);

    const handler = routes["/loom/:projectId/:loomName"];
    expect(typeof handler).toBe("function");

    const url = new URL(`http://localhost/loom/${proj.id}/foo`);
    const req = new Request(url, { method: "GET" });
    const res = await handler(req, url);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.projectId).toBe(proj.id);
    expect(body.loomName).toBe("foo");
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
    invalidateLoomViewCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    const url = new URL("http://localhost/loom/missing-id/foo");
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(404);
    await store.close();
  });

  test("404 on missing loom directory", async () => {
    invalidateLoomViewCache();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-route-test-"));
    tmpRoots.push(root);
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    const url = new URL(`http://localhost/loom/${proj.id}/nope`);
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(404);
    await store.close();
  });

  test("rejects path-traversal loom names", async () => {
    invalidateLoomViewCache();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({
      name: "p",
      paths: [fs.mkdtempSync(path.join(os.tmpdir(), "loom-route-test-"))],
    });
    tmpRoots.push(proj.paths[0]);
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    // The encoded `..` survives URL parsing; the handler must reject it.
    const url = new URL(
      `http://localhost/loom/${proj.id}/${encodeURIComponent("../etc")}`,
    );
    const res = await handler(new Request(url), url);
    expect(res.status).toBe(400);
    await store.close();
  });

  test("caches result within 1s window", async () => {
    invalidateLoomViewCache();
    const root = makeLoom("c1", { "spec.md": "first" });
    const store = await initMetadataStore({ inMemoryOnly: true });
    const proj = store.projects.create({ name: "p", paths: [root] });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];

    const url = new URL(`http://localhost/loom/${proj.id}/c1`);
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
