/**
 * FabricViewer + JsonView format-dispatch contract (T-002, extended in T-003).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - JsonView.tsx exists and renders pretty-printed JSON inside <pre>
 *     and falls back to the raw source on parse failure.
 *   - FabricViewer.tsx exists and dispatches by extension: `.md` →
 *     FabricMarkdown, `.json` → JsonView, otherwise → wrapped <pre>.
 *   - The "No content available for {path}." copy lives in the
 *     `content === undefined` branch.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const jsonViewPath = webRoot + "src/components/fabric/JsonView.tsx";
const viewerPath = webRoot + "src/components/fabric/FabricViewer.tsx";

describe("JsonView component contract", () => {
  test("JsonView.tsx exists at the documented path", () => {
    expect(existsSync(jsonViewPath)).toBe(true);
  });

  test("exports a named function `JsonView` with a `source` prop", () => {
    const src = readFileSync(jsonViewPath, "utf8");
    expect(src).toMatch(/export\s+function\s+JsonView\b/);
    expect(src).toMatch(/source\s*:\s*string/);
  });

  test("pretty-prints valid JSON with 2-space indent", () => {
    const src = readFileSync(jsonViewPath, "utf8");
    expect(src).toMatch(/JSON\.parse\(/);
    expect(src).toMatch(/JSON\.stringify\(\s*parsed\s*,\s*null\s*,\s*2\s*\)/);
  });

  test("falls back to a plain <pre> on parse failure", () => {
    const src = readFileSync(jsonViewPath, "utf8");
    expect(src).toMatch(/<pre\b/);
    expect(src).toMatch(/whitespace-pre-wrap/);
    expect(src).toMatch(/catch\b/);
  });

  test("integrates with shiki-loader for JSON syntax highlighting", () => {
    const src = readFileSync(jsonViewPath, "utf8");
    expect(src).toMatch(/shiki-loader/);
    expect(src).toMatch(/highlightSync/);
    expect(src).toMatch(/loadHighlighter/);
    expect(src).toMatch(/"json"/);
  });
});

describe("FabricViewer dispatcher contract", () => {
  test("FabricViewer.tsx exists at the documented path", () => {
    expect(existsSync(viewerPath)).toBe(true);
  });

  test("exports a named function `FabricViewer` with `path` + `content` props", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/export\s+function\s+FabricViewer\b/);
    expect(src).toMatch(/path\s*:\s*string/);
    expect(src).toMatch(/content\s*:\s*string\s*\|\s*undefined/);
  });

  test("dispatches .md to FabricMarkdown", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/FabricMarkdown["']/);
    expect(src).toMatch(/\.endsWith\(\s*["']\.md["']\s*\)/);
    expect(src).toMatch(/<FabricMarkdown\b/);
  });

  test("dispatches .json to JsonView", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/JsonView["']/);
    expect(src).toMatch(/\.endsWith\(\s*["']\.json["']\s*\)/);
    expect(src).toMatch(/<JsonView\b/);
  });

  test("renders 'No content available' when content is undefined", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/No content available for/);
    expect(src).toMatch(/content === undefined|content == null|!content/);
  });

  test("falls through to a wrapped <pre> for other extensions", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/<pre\b[^>]*whitespace-pre-wrap/);
  });

  test("dispatches .txt to the wrapped monospace <pre> branch", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/\.endsWith\(\s*["']\.txt["']\s*\)|\.txt/);
    expect(src).toMatch(/text-\[12px\]\s+font-mono\s+whitespace-pre-wrap/);
  });

  test("wraps long lines via the whitespace-pre-wrap class", () => {
    const src = readFileSync(viewerPath, "utf8");
    expect(src).toMatch(/whitespace-pre-wrap/);
  });
});
