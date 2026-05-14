/**
 * Smoke check for FabricViewLive — confirms the route file exists,
 * exports the named component, accepts the documented props shape,
 * and is wired into App.tsx as the dynamic `/fabric/:projectId/:fabricName`
 * route. We deliberately avoid spinning up React/JSDOM here to stay
 * in line with the existing static-string smoke tests.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("FabricViewLive route wiring", () => {
  test("fabric-view-live.tsx exists and exports FabricViewLive", () => {
    const p = root + "src/routes/fabric-view-live.tsx";
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toContain("export function FabricViewLive");
    // Component must accept the documented prop shape.
    expect(src).toContain("projectId: string");
    expect(src).toContain("fabricName: string");
    // Auto-refresh wiring (5 s poll) per spec.
    expect(src).toContain("5000");
    // Fetches the new live endpoint (not the static-demo route).
    expect(src).toContain("/api/fabric/");
    // Manual refresh now lives inside the FileTreeDrawer header.
    expect(src).toContain("FileTreeDrawer");
    expect(src).toMatch(/onRefresh=\{[^}]*fetchData/);
    // Markdown rendering flows through the extracted FabricMarkdown
    // component instead of inline `marked.parse` in the route.
    expect(src).toContain("FabricMarkdown");
  });

  test("App.tsx mounts the dynamic fabric route", () => {
    const app = readFileSync(root + "src/App.tsx", "utf8");
    expect(app).toContain('path="/fabric/:projectId/:fabricName"');
    expect(app).toContain("FabricViewLive");
  });

  test("marked is in package.json", () => {
    const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
    expect(pkg.dependencies?.marked).toBeDefined();
  });
});
