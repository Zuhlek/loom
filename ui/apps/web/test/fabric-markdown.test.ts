/**
 * FabricMarkdown component contract (T-001).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the component file exists at the documented path and exports
 *     `FabricMarkdown` with a `{ source: string }` prop.
 *   - the module configures marked with `gfm: true, breaks: false`
 *     (authored markdown, not chat prose).
 *   - the render path emits a single `<article>` and uses
 *     `dangerouslySetInnerHTML`.
 *   - the route consumes `<FabricMarkdown>` and no longer inlines
 *     `marked.parse` directly.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const componentPath =
  webRoot + "src/components/fabric/FabricMarkdown.tsx";
const routePath = webRoot + "src/routes/fabric-view-live.tsx";
const viewerPath = webRoot + "src/components/fabric/FabricViewer.tsx";

describe("FabricMarkdown component contract", () => {
  test("FabricMarkdown.tsx exists at the documented path", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  test("exports a named function `FabricMarkdown` with a `source` prop", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/export\s+function\s+FabricMarkdown\b/);
    expect(src).toMatch(/source\s*:\s*string/);
  });

  test("module configures marked with gfm: true and breaks: false", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/marked\.setOptions\(/);
    expect(src).toMatch(/gfm\s*:\s*true/);
    expect(src).toMatch(/breaks\s*:\s*false/);
  });

  test("render path produces a single <article> via dangerouslySetInnerHTML", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/<article\b/);
    expect(src).toMatch(/dangerouslySetInnerHTML/);
  });

  test("falls back to a <pre> wrapping the raw source on marked.parse error", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/<pre\b/);
    expect(src).toMatch(/catch\b/);
  });

  test("FabricViewer consumes FabricMarkdown (route no longer inlines marked.parse)", () => {
    // The route renders <FabricViewer>, which delegates markdown rendering
    // to <FabricMarkdown>. The contract — markdown is rendered via the
    // shared component, not an inline marked.parse — now lives one boundary
    // deeper in FabricViewer.
    const viewerSrc = readFileSync(viewerPath, "utf8");
    expect(viewerSrc).toMatch(/from\s+["']\.\/FabricMarkdown["']/);
    expect(viewerSrc).toMatch(/<FabricMarkdown\b/);

    const routeSrc = readFileSync(routePath, "utf8");
    expect(routeSrc).not.toMatch(/marked\.parse/);
  });
});
