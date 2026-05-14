/**
 * FabricFileTree extraction smoke test (T-012).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the standalone component file exists and exports `FabricFileTree`.
 *   - the helpers (`buildTree`, `TreeRow`, `humanSize`, `ChevronIcon`,
 *     `FolderIcon`, `FileIcon`) live in the extracted module, not the
 *     route.
 *   - the route imports `FabricFileTree` from the new module instead
 *     of declaring it inline.
 *   - the initial `collapsed` state seeds every directory as collapsed
 *     rather than starting `{}` (all-open).
 *   - the `FabricFileTreeProps` interface carries the documented shape.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const treePath = webRoot + "src/components/fabric/FabricFileTree.tsx";
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricFileTree extraction", () => {
  test("FabricFileTree.tsx exists at the documented path", () => {
    expect(existsSync(treePath)).toBe(true);
  });

  test("FabricFileTree.tsx exports a named React component", () => {
    const src = readFileSync(treePath, "utf8");
    expect(src).toMatch(/export\s+function\s+FabricFileTree\b/);
  });

  test("Helpers move to the extracted module", () => {
    const src = readFileSync(treePath, "utf8");
    expect(src).toMatch(/function\s+buildTree\b/);
    expect(src).toMatch(/function\s+TreeRow\b/);
    expect(src).toMatch(/function\s+humanSize\b/);
    expect(src).toMatch(/function\s+ChevronIcon\b/);
    expect(src).toMatch(/function\s+FolderIcon\b/);
    expect(src).toMatch(/function\s+FileIcon\b/);
  });

  test("Props interface mentions tree, artifacts, selectedPath, onSelect", () => {
    const src = readFileSync(treePath, "utf8");
    expect(src).toMatch(/selectedPath/);
    expect(src).toMatch(/onSelect/);
    expect(src).toMatch(/tree\??:/);
    expect(src).toMatch(/artifacts\??:/);
  });

  test("Initial collapsed map seeds every directory as collapsed", () => {
    const src = readFileSync(treePath, "utf8");
    expect(src).toMatch(/isDirectory/);
    expect(src).toMatch(/useState[\s\S]{0,80}=>[\s\S]{0,200}true/);
  });

  test("Route reaches the tree via FileTreeDrawer (which wraps the extracted module)", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/from\s+["']\.\.\/components\/fabric\/FileTreeDrawer["']/);
    const drawerSrc = readFileSync(
      webRoot + "src/components/fabric/FileTreeDrawer.tsx",
      "utf8",
    );
    expect(drawerSrc).toMatch(/from\s+["']\.\/FabricFileTree["']/);
  });

  test("Route no longer defines the tree helpers inline", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).not.toMatch(/function\s+FabricFileTree\b/);
    expect(src).not.toMatch(/function\s+TreeRow\b/);
    expect(src).not.toMatch(/function\s+buildTree\b/);
    expect(src).not.toMatch(/function\s+humanSize\b/);
  });
});
