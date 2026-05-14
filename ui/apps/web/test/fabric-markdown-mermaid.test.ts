/**
 * Mermaid rendering integration (T-004).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - `lib/mermaid-loader.ts` exists, memoises the dynamic import
 *     promise, and pins `initialize({ startOnLoad: false,
 *     securityLevel: "strict", theme: "default" })`.
 *   - `components/fabric/MermaidBlock.tsx` exists, lazy-loads via the
 *     loader, renders the SVG via dangerouslySetInnerHTML, and falls
 *     back to <pre><code class="language-mermaid"> on parse failure.
 *   - `FabricMarkdown.tsx` registers a marked extension that matches
 *     fenced ```mermaid blocks via `lang === "mermaid"`, stores the
 *     raw source in a module-scope Map, and emits a placeholder
 *     `<div class="loom-mermaid-block" data-source-id="...">`.
 *   - The mermaid npm dep is declared in `ui/apps/web/package.json`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const loaderPath = webRoot + "src/lib/mermaid-loader.ts";
const blockPath = webRoot + "src/components/fabric/MermaidBlock.tsx";
const markdownPath = webRoot + "src/components/fabric/FabricMarkdown.tsx";
const pkgPath = webRoot + "package.json";

describe("mermaid-loader contract", () => {
  test("mermaid-loader.ts exists at the documented path", () => {
    expect(existsSync(loaderPath)).toBe(true);
  });

  test("exposes a memoised loadMermaid function", () => {
    const src = readFileSync(loaderPath, "utf8");
    expect(src).toMatch(/export\s+function\s+loadMermaid\b/);
    expect(src).toMatch(/import\(["']mermaid["']\)/);
    expect(src).toMatch(/let\s+promise\b/);
  });

  test("initialize is pinned to the locked options", () => {
    const src = readFileSync(loaderPath, "utf8");
    expect(src).toMatch(/initialize\(/);
    expect(src).toMatch(/startOnLoad\s*:\s*false/);
    expect(src).toMatch(/securityLevel\s*:\s*["']strict["']/);
    expect(src).toMatch(/theme\s*:\s*["']default["']/);
  });
});

describe("MermaidBlock component contract", () => {
  test("MermaidBlock.tsx exists at the documented path", () => {
    expect(existsSync(blockPath)).toBe(true);
  });

  test("exports a named function `MermaidBlock` with `source` prop", () => {
    const src = readFileSync(blockPath, "utf8");
    expect(src).toMatch(/export\s+function\s+MermaidBlock\b/);
    expect(src).toMatch(/source\s*:\s*string/);
  });

  test("imports the shared loader (no direct `import('mermaid')`)", () => {
    const src = readFileSync(blockPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\.\/\.\.\/lib\/mermaid-loader["']/);
    expect(src).toMatch(/loadMermaid\b/);
  });

  test("renders the SVG via dangerouslySetInnerHTML and falls back to <pre><code>", () => {
    const src = readFileSync(blockPath, "utf8");
    expect(src).toMatch(/dangerouslySetInnerHTML/);
    expect(src).toMatch(/language-mermaid/);
  });
});

describe("FabricMarkdown mermaid extension", () => {
  const src = readFileSync(markdownPath, "utf8");

  test("registers a marked tokenizer that matches `lang === 'mermaid'`", () => {
    expect(src).toMatch(/marked\.use\(/);
    expect(src).toMatch(/lang\s*===\s*["']mermaid["']|token\.lang\s*===\s*["']mermaid["']/);
  });

  test("emits placeholder divs with loom-mermaid-block class and data-source-id", () => {
    expect(src).toMatch(/loom-mermaid-block/);
    expect(src).toMatch(/data-source-id/);
  });

  test("stores raw sources in a module-scope Map keyed by id (no base64)", () => {
    expect(src).toMatch(/new\s+Map<\s*string\s*,\s*string\s*>/);
    expect(src).not.toMatch(/btoa\(|atob\(/);
  });

  test("uses createRoot to mount MermaidBlock into placeholders", () => {
    expect(src).toMatch(/createRoot\b/);
    expect(src).toMatch(/MermaidBlock\b/);
  });

  test("uses marked-shiki for fenced code highlighting", () => {
    expect(src).toMatch(/marked-shiki/);
    expect(src).toMatch(/markedShiki/);
  });
});

describe("mermaid dep declared in package.json", () => {
  test("mermaid appears in dependencies", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.mermaid).toBeDefined();
  });
});
