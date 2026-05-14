/**
 * `routes/fabric.ts` exposes only a read-only handler for the fabric
 * view surface. The phase pipeline this route reflects is owned by
 * `/weave`; the UI must not mutate it via this surface.
 *
 * Style matches the project's server tests (Vitest, runtime = node,
 * `*.test.ts` only). We drive `mountFabricRoute` against a stub
 * registry and assert:
 *   1. Exactly one route is mounted on `/fabric/:projectId/:fabricName`.
 *   2. A non-GET request to that handler returns 405.
 *   3. A GET request still resolves normally (404 for an unknown
 *      project — which is the existing happy-path-for-missing-data
 *      behaviour).
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountFabricRoute } from "../src/routes/fabric.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const routeFilePath = fileURLToPath(
  new URL("../src/routes/fabric.ts", import.meta.url),
);

describe("routes/fabric.ts is read-only for the fabric view surface", () => {
  test("fabric.ts top-of-file docstring documents the read-only contract", () => {
    const src = readFileSync(routeFilePath, "utf8");
    const head = src.slice(0, 800);
    expect(head).toMatch(/read-only/i);
    expect(head).toMatch(/\/weave\b/);
  });

  test("mountFabricRoute mounts a single handler at /fabric/:projectId/:fabricName", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const keys = Object.keys(routes).filter((k) => k.includes("/fabric/"));
    expect(keys).toEqual(["/fabric/:projectId/:fabricName"]);
    await store.close();
  });

  test("POST /fabric/:projectId/:fabricName returns 405", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    expect(handler).toBeDefined();
    const req = new Request("http://localhost/fabric/p1/spec", { method: "POST" });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(405);
    await store.close();
  });

  test("PATCH and DELETE /fabric/:projectId/:fabricName return 405", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const req = new Request("http://localhost/fabric/p1/spec", { method });
      const res = await handler(req, new URL(req.url));
      expect(res.status).toBe(405);
    }
    await store.close();
  });

  test("GET /fabric/:projectId/:fabricName still resolves to 404 for an unknown project", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountFabricRoute(routes, store);
    const handler = routes["/fabric/:projectId/:fabricName"];
    const req = new Request("http://localhost/fabric/unknown/spec", { method: "GET" });
    const res = await handler(req, new URL(req.url));
    expect(res.status).toBe(404);
    await store.close();
  });
});
