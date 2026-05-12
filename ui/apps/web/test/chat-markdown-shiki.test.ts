/**
 * T-009 — Shiki syntax highlighting via marked-shiki.
 *
 * Test style matches the project's existing static-string + pure-logic
 * smoke pattern (apps/web/test/smoke.test.ts, loom-view-live.test.ts):
 * we deliberately avoid jsdom + @testing-library to keep the test
 * environment infrastructure-free. The vitest config glob includes
 * `apps/**\/test/**\/*.test.ts` only.
 *
 * What we assert:
 *   1. shiki-loader exposes the curated SUPPORTED_LANGS subset, a
 *      lazy `loadHighlighter`, and a sync `highlightSync`.
 *   2. After `loadHighlighter("ts")` resolves, `highlightSync(code, "ts")`
 *      returns a non-null string containing Shiki's `class="shiki"`
 *      hook (or a style="color:" token), proving Shiki actually ran.
 *   3. Unsupported langs make `highlightSync` return `null` so the
 *      ChatMarkdown caller can fall back to plain <pre><code> without
 *      crashing.
 *   4. `loadHighlighter` is idempotent — calling it twice for the same
 *      lang returns the same Highlighter handle and does not re-import.
 *   5. `ChatMarkdown.tsx` is wired to `marked-shiki` + `shiki-loader`
 *      and does NOT enable `marked.setOptions({ html: true })`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;

describe("T-009 shiki-loader contract", () => {
  test("shiki-loader.ts exists at the documented path", () => {
    expect(existsSync(webRoot + "src/lib/shiki-loader.ts")).toBe(true);
  });

  test("SUPPORTED_LANGS is the curated subset from Design ADR-005", async () => {
    const mod = await import("../src/lib/shiki-loader");
    expect(Array.isArray(mod.SUPPORTED_LANGS)).toBe(true);
    // From task T-009 + Design ADR-005:
    //   ts, tsx, js, jsx, python, bash, sh, json, md, html, css
    const expected = [
      "ts", "tsx", "js", "jsx", "python", "bash", "sh",
      "json", "md", "html", "css",
    ];
    for (const lang of expected) {
      expect(mod.SUPPORTED_LANGS).toContain(lang);
    }
  });

  test("loadHighlighter('ts') resolves and registers the grammar; highlightSync returns Shiki HTML", async () => {
    const { loadHighlighter, highlightSync } = await import(
      "../src/lib/shiki-loader"
    );
    await loadHighlighter("ts");
    const html = highlightSync("const x: number = 1;", "ts");
    expect(html).not.toBeNull();
    // Shiki emits a <pre class="shiki ..."> wrapper and inline color
    // styles. Either marker proves Shiki actually rendered.
    expect(html as string).toMatch(/class="shiki|style="color:/);
  });

  test("highlightSync returns null for an unsupported lang (caller falls back to plain pre/code)", async () => {
    const { highlightSync } = await import("../src/lib/shiki-loader");
    expect(highlightSync("CODE", "cobol")).toBeNull();
  });

  test("loadHighlighter is idempotent — second call for same lang returns the same Highlighter handle", async () => {
    const { loadHighlighter } = await import("../src/lib/shiki-loader");
    const a = await loadHighlighter("bash");
    const b = await loadHighlighter("bash");
    // Singleton Shiki highlighter shared across calls (loader caches).
    expect(a).toBe(b);
  });
});

describe("T-009 ChatMarkdown integration", () => {
  const file = webRoot + "src/components/chat/ChatMarkdown.tsx";

  test("ChatMarkdown wires marked-shiki + shiki-loader and preserves the streaming caret", () => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("marked-shiki");
    // The lazy loader is the single source of grammar registration.
    expect(src).toContain("shiki-loader");
    // marked.use(...) call site at module scope per ADR-005.
    expect(src).toContain("marked.use(");
    // Streaming caret element must survive the rewrite (US-002 AC4).
    expect(src).toContain("streaming-caret");
  });

  test("ChatMarkdown does NOT enable raw-HTML passthrough (Spec ## Constraints)", () => {
    const src = readFileSync(file, "utf8");
    // The Constraint: `marked.setOptions({ html: true })` MUST NOT be set.
    // Allow `gfm: true` and `breaks: true` (the existing options) but
    // explicitly forbid `html: true`.
    expect(src).not.toMatch(/html:\s*true/);
  });
});
