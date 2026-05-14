/**
 * T-014 — `routes/loom.ts` exposes only a read-only handler for the
 * loom view surface (US-009 AC4, AC5).
 *
 * Style matches the project's server tests (Vitest, runtime = node,
 * `*.test.ts` only). We drive `mountLoomRoute` against a stub
 * registry and assert:
 *   1. Exactly one route is mounted on `/loom/:projectId/:loomName`.
 *   2. A non-GET request to that handler returns 405.
 *   3. A GET request still resolves normally (404 for an unknown
 *      project — which is the existing happy-path-for-missing-data
 *      behaviour).
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountLoomRoute } from "../src/routes/loom.ts";
import { readFileSync } from "node:fs";

const routeFilePath = new URL("../src/routes/loom.ts", import.meta.url).pathname;

describe("T-014 routes/loom.ts is read-only for the loom view surface", () => {
  test("loom.ts top-of-file docstring documents the read-only contract", () => {
    const src = readFileSync(routeFilePath, "utf8");
    const head = src.slice(0, 800);
    expect(head).toMatch(/read-only/i);
    expect(head).toMatch(/\/weave\b/);
  });

  test("mountLoomRoute mounts a single handler at /loom/:projectId/:loomName", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const keys = Object.keys(routes).filter((k) => k.includes("/loom/"));
    expect(keys).toEqual(["/loom/:projectId/:loomName"]);
    await store.close();
  });

  test("POST /loom/:projectId/:loomName returns 405", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/loom/p1/spec", { method: "POST" });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(405);
    await store.close();
  });

  test("PATCH and DELETE /loom/:projectId/:loomName return 405", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const req = new Request("http://localhost/loom/p1/spec", { method });
      const res = await handler(req, new URL(req.url));
      expect(res.status).toBe(405);
    }
    await store.close();
  });

  test("GET /loom/:projectId/:loomName still resolves to 404 for an unknown project", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountLoomRoute(routes, store);
    const handler = routes["/loom/:projectId/:loomName"];
    const req = new Request("http://localhost/loom/unknown/spec", { method: "GET" });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(404);
    await store.close();
  });
});
