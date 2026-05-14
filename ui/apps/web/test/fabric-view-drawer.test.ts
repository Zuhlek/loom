/**
 * Two-pane layout — main + always-visible file tree.
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the route consumes `AppLayout.rightDrawer` and never re-introduces
 *     the rail/toggle column.
 *   - `selectedFile` state defaults to null; phase initialises from the
 *     pipeline.
 *   - `FileTreeDrawer` mounts unconditionally once data has loaded.
 *   - the standalone right viewer column is gone (file content takes
 *     over the center pane instead).
 *   - the legacy inline `marked.parse` call is gone from the route.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricViewLive — two-pane layout", () => {
  const src = readFileSync(routePath, "utf8");

  test("route wires the rightDrawer slot", () => {
    expect(src).toMatch(/rightDrawer\s*=/);
  });

  test("route no longer wires a rightRail slot", () => {
    expect(src).not.toMatch(/rightRail\s*=/);
  });

  test("rail-toggle test id is gone", () => {
    expect(src).not.toMatch(/data-testid="fabric-tree-toggle"/);
  });

  test("drawerOpen state is gone (tree is always visible)", () => {
    expect(src).not.toMatch(/setDrawerOpen|drawerOpen/);
  });

  test("route holds selectedFile state defaulting to null", () => {
    expect(src).toMatch(/setSelectedFile/);
    expect(src).toMatch(/useState<string \| null>\(null\)|useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\)/);
  });

  test("FileTreeDrawer is mounted once data has loaded", () => {
    expect(src).toMatch(/<FileTreeDrawer\b/);
    expect(src).toMatch(/data\s*\?\s*\(\s*<FileTreeDrawer/);
  });

  test("right viewer column is removed", () => {
    expect(src).not.toMatch(/data-testid="fabric-viewer-column"/);
  });

  test("route no longer inlines `marked.parse`", () => {
    expect(src).not.toMatch(/marked\.parse\b/);
  });

  test("FileTreeDrawer component file exists", () => {
    const drawerPath = webRoot + "src/components/fabric/FileTreeDrawer.tsx";
    expect(existsSync(drawerPath)).toBe(true);
  });
});

describe("FileTreeDrawer component contract", () => {
  const drawerPath = webRoot + "src/components/fabric/FileTreeDrawer.tsx";
  const src = readFileSync(drawerPath, "utf8");

  test("exports a named function `FileTreeDrawer` with the slim props", () => {
    expect(src).toMatch(/export\s+function\s+FileTreeDrawer\b/);
    expect(src).toMatch(/tree\s*:/);
    expect(src).toMatch(/artifacts\s*:/);
    expect(src).toMatch(/selectedPath\s*:/);
    expect(src).toMatch(/onSelect\s*:/);
  });

  test("rootLabel header and refresh button are gone", () => {
    expect(src).not.toMatch(/rootLabel/);
    expect(src).not.toMatch(/data-testid="fabric-refresh"/);
    expect(src).not.toMatch(/onRefresh/);
  });

  test("wraps FabricFileTree", () => {
    expect(src).toMatch(/<FabricFileTree\b/);
  });

  test("aside uses w-64 + border-l + var(--card) background", () => {
    expect(src).toMatch(/<aside\b/);
    expect(src).toMatch(/w-64/);
    expect(src).toMatch(/border-l/);
    expect(src).toMatch(/var\(--card\)/);
  });
});
