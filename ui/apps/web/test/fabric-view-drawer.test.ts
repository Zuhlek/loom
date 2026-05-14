/**
 * Three-surface layout — drawer + rail (T-006, extended in T-007).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the route consumes `AppLayout.rightDrawer` and `AppLayout.rightRail`
 *     slots and never introduces a new layout primitive.
 *   - `drawerOpen` + `selectedFile` state slots exist with the documented
 *     defaults.
 *   - the rail icon toggles drawer state; closing the rail also clears
 *     `selectedFile` (ADR-006).
 *   - the drawer panel is mounted iff `drawerOpen`.
 *   - the viewer column is mounted iff `drawerOpen && selectedFile !== null`.
 *   - `<FabricViewer>` is the viewer-column renderer.
 *   - the legacy inline `marked.parse` call is gone from the route.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricViewLive — three-surface layout", () => {
  const src = readFileSync(routePath, "utf8");

  test("route wires rightDrawer and rightRail slots", () => {
    expect(src).toMatch(/rightDrawer\s*=/);
    expect(src).toMatch(/rightRail\s*=/);
  });

  test("route holds drawerOpen state defaulting to false", () => {
    expect(src).toMatch(/setDrawerOpen/);
    expect(src).toMatch(/useState<boolean>\(false\)|useState\(false\)/);
  });

  test("route holds selectedFile state defaulting to null", () => {
    expect(src).toMatch(/setSelectedFile/);
    expect(src).toMatch(/useState<string \| null>\(null\)|useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\)/);
  });

  test("rail-icon close handler clears selectedFile (ADR-006)", () => {
    expect(src).toMatch(/setSelectedFile\(null\)/);
  });

  test("drawer-open gate guards both the tree and the viewer column", () => {
    expect(src).toMatch(/drawerOpen\s*&&/);
  });

  test("viewer column mounts iff drawerOpen && selectedFile !== null", () => {
    expect(src).toMatch(/drawerOpen\s*&&\s*selectedFile/);
  });

  test("viewer-column uses FabricViewer", () => {
    expect(src).toMatch(/from\s+["']\.\.\/components\/fabric\/FabricViewer["']/);
    expect(src).toMatch(/<FabricViewer\b/);
  });

  test("route no longer inlines `marked.parse`", () => {
    expect(src).not.toMatch(/marked\.parse\b/);
  });

  test("rail icon button carries the documented test id", () => {
    expect(src).toMatch(/data-testid="fabric-tree-toggle"/);
  });

  test("drawer panel is rendered via the FileTreeDrawer component", () => {
    expect(src).toMatch(/<FileTreeDrawer\b/);
  });

  test("top bar no longer carries data-testid='fabric-refresh'", () => {
    const topBarSliceStart = src.indexOf("const topBar");
    const topBarSliceEnd = src.indexOf("const rightRail");
    expect(topBarSliceStart).toBeGreaterThan(-1);
    expect(topBarSliceEnd).toBeGreaterThan(topBarSliceStart);
    const topBarSlice = src.slice(topBarSliceStart, topBarSliceEnd);
    expect(topBarSlice).not.toMatch(/data-testid="fabric-refresh"/);
  });

  test("FileTreeDrawer component file exists", () => {
    const drawerPath = webRoot + "src/components/fabric/FileTreeDrawer.tsx";
    expect(existsSync(drawerPath)).toBe(true);
  });
});

describe("FileTreeDrawer component contract", () => {
  const drawerPath = webRoot + "src/components/fabric/FileTreeDrawer.tsx";
  const src = readFileSync(drawerPath, "utf8");

  test("exports a named function `FileTreeDrawer` with the documented props", () => {
    expect(src).toMatch(/export\s+function\s+FileTreeDrawer\b/);
    expect(src).toMatch(/rootLabel\s*:\s*string/);
    expect(src).toMatch(/onRefresh\s*:\s*\(/);
  });

  test("renders the refresh icon button inside the header", () => {
    expect(src).toMatch(/data-testid="fabric-refresh"/);
    expect(src).toMatch(/onClick=\{[^}]*onRefresh/);
  });

  test("renders the root label uppercased + tracking-wider", () => {
    expect(src).toMatch(/tracking-wider/);
    expect(src).toMatch(/rootLabel\.toUpperCase\(\)/);
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
