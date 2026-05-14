/**
 * Viewer-column toggle semantics (T-006 seeds, T-011 extends).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - file-row click handler uses the toggle-off pattern
 *     `(prev) => prev === clicked ? null : clicked`.
 *   - directory-row clicks never reach into the file-selection state.
 *   - the rail icon's highlighted state is driven by `drawerOpen`,
 *     not by `selectedFile`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricViewLive — viewer-column toggle semantics", () => {
  const src = readFileSync(routePath, "utf8");

  test("file-row handler toggles off when re-clicking the same path", () => {
    expect(src).toMatch(
      /setSelectedFile\s*\(\s*\(\s*prev\s*\)\s*=>\s*\(?\s*prev\s*===\s*[A-Za-z_]+\s*\?\s*null\s*:/,
    );
  });

  test("viewer-column gate requires both drawerOpen and selectedFile", () => {
    expect(src).toMatch(/drawerOpen\s*&&\s*selectedFile\s*!==\s*null/);
  });

  test("rail icon `aria-pressed` is driven by drawerOpen", () => {
    expect(src).toMatch(/aria-pressed=\{drawerOpen\}/);
  });

  test("handleFileSelect goes through the route, not the tree", () => {
    expect(src).toMatch(/handleFileSelect\b/);
    expect(src).toMatch(/<FileTreeDrawer\b[\s\S]*?onSelect=\{handleFileSelect\}/);
  });

  test("rail-icon close clears selectedFile (ADR-006)", () => {
    expect(src).toMatch(/setSelectedFile\(null\)/);
  });

  test("rail icon highlighted state is NOT keyed by selectedFile", () => {
    const railStart = src.indexOf("const rightRail");
    const railEnd = src.indexOf("const rightDrawer", railStart);
    const railSlice = src.slice(railStart, railEnd);
    expect(railSlice).toMatch(/aria-pressed=\{drawerOpen\}/);
    expect(railSlice).not.toMatch(/selectedFile/);
  });
});
