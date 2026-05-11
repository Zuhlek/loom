/**
 * Smoke check for LoomViewLive — confirms the route file exists,
 * exports the named component, accepts the documented props shape,
 * and is wired into App.tsx as the dynamic `/loom/:projectId/:loomName`
 * route. We deliberately avoid spinning up React/JSDOM here to stay
 * in line with the existing static-string smoke tests.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;

describe("LoomViewLive route wiring", () => {
  test("loom-view-live.tsx exists and exports LoomViewLive", () => {
    const p = root + "src/routes/loom-view-live.tsx";
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toContain("export function LoomViewLive");
    // Component must accept the documented prop shape.
    expect(src).toContain("projectId: string");
    expect(src).toContain("loomName: string");
    // Auto-refresh wiring (5 s poll) per spec.
    expect(src).toContain("5000");
    // Fetches the new live endpoint (not the static-demo route).
    expect(src).toContain("/api/loom/");
    // Manual refresh button is present and tagged for testing.
    expect(src).toContain('data-testid="loom-refresh"');
    // Markdown rendering is wired.
    expect(src).toContain("marked.parse");
  });

  test("App.tsx mounts the dynamic loom route BEFORE the static demo", () => {
    const app = readFileSync(root + "src/App.tsx", "utf8");
    expect(app).toContain('path="/loom/:projectId/:loomName"');
    expect(app).toContain("LoomViewLive");
    // Static demo must still exist for the mockup browser.
    expect(app).toContain('path="/loom/:phase?"');
    // Wouter matches in declaration order; the more specific route
    // must come first or the static demo wins.
    const dyn = app.indexOf('path="/loom/:projectId/:loomName"');
    const stat = app.indexOf('path="/loom/:phase?"');
    expect(dyn).toBeGreaterThan(0);
    expect(stat).toBeGreaterThan(0);
    expect(dyn).toBeLessThan(stat);
  });

  test("marked is in package.json", () => {
    const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
    expect(pkg.dependencies?.marked).toBeDefined();
  });
});
