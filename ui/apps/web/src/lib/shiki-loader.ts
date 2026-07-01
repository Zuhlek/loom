/**
 * Shiki lazy-load registry for ChatMarkdown.
 *
 * Owns one Shiki HighlighterCore for the whole web app. Grammars are
 * loaded on first use; subsequent calls for the same grammar resolve
 * immediately against the cached highlighter (idempotent). Theme is
 * hard-coded `github-dark` per Design ADR-005 (loom is dark-themed
 * only; no runtime theme switching).
 *
 * Two-API split is deliberate:
 *   - `loadHighlighter(lang)` is async — must be awaited before the
 *     grammar is available.
 *   - `highlightSync(code, lang)` is synchronous — returns the
 *     highlighted HTML if the grammar is already loaded, else `null`
 *     so the caller can render plain <pre><code> for THIS frame and
 *     let the next render (e.g. next streaming delta) pick up the
 *     now-loaded grammar.
 *
 * This split is what lets `ChatMarkdown.tsx` keep marked's synchronous
 * render contract intact (see ADR-005).
 *
 * Bundle policy (Design ## Constraints):
 *   We deliberately use `shiki/core` + per-language dynamic imports
 *   from `shiki/langs/<name>` instead of the `shiki` top-level
 *   re-export. The top-level re-export pulls in every grammar Shiki
 *   ships (~22 MB across hundreds of chunks via the bundle-full path).
 *   The fine-grained imports below let Vite code-split exactly the
 *   curated 11-grammar subset (TS / TSX / JS / JSX / Python / Bash /
 *   Sh / JSON / Markdown / HTML / CSS), keeping the cold-cache budget
 *   in the 60–80 KB gzipped target.
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Curated grammar subset — TS / TSX / JS / JSX / Python / Bash / Sh /
 * JSON / Markdown / HTML / CSS. Anything outside this list falls back
 * to plain `<pre><code>` rendering in `ChatMarkdown`.
 */
export const SUPPORTED_LANGS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "python",
  "bash",
  "sh",
  "json",
  "md",
  "html",
  "css",
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** Single hard-coded theme — see ADR-005. */
const THEME = "github-dark" as const;

/**
 * Static map of curated-lang → dynamic-import-factory. Each entry is a
 * separate dynamic `import()` so Vite emits one chunk per grammar; the
 * factories are NEVER invoked at module-load time — only on demand
 * from `loadHighlighter(lang)`.
 *
 * NOTE: keys here MUST exactly match `SUPPORTED_LANGS`. Shiki's
 * registered grammar name is taken from the imported grammar's `name`
 * field (see `loadHighlighter` below).
 */
const LANG_LOADERS: Record<SupportedLang, () => Promise<unknown>> = {
  ts: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  js: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  sh: () => import("shiki/langs/shellscript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
};

/**
 * Aliases the curated key → the registered Shiki grammar name. The
 * Shiki grammar's own `name` field may differ from our short alias
 * (e.g. `ts` → `typescript`); we register under the grammar's own
 * name and the alias resolves via Shiki's `embeddedLangs` handling.
 *
 * For our purposes we always pass the alias through to `codeToHtml`
 * and rely on Shiki's alias resolution.
 */
const LANG_TO_REGISTERED: Record<SupportedLang, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  python: "python",
  bash: "bash",
  sh: "shellscript",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
};

/** Module-singleton state. */
let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;
const loadingByLang = new Map<SupportedLang, Promise<HighlighterCore>>();
const loadedLangs = new Set<SupportedLang>();

/** True iff `lang` is in the curated subset. */
export function isSupportedLang(lang: string): lang is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

async function ensureHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (!highlighterPromise) {
    // Lazy theme import keeps the theme chunk separate from the main
    // bundle until the first highlight call.
    highlighterPromise = createHighlighterCore({
      themes: [import("shiki/themes/github-dark.mjs")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  highlighter = await highlighterPromise;
  return highlighter;
}

/**
 * Ensure a Shiki HighlighterCore exists (lazy, singleton) and that the
 * given grammar is registered on it. Idempotent — repeated calls for
 * the same `lang` return the same Highlighter handle without
 * re-importing the grammar.
 */
export async function loadHighlighter(
  lang: SupportedLang,
): Promise<HighlighterCore> {
  // Coalesce concurrent loads for the same lang into one promise.
  const inflight = loadingByLang.get(lang);
  if (inflight) return inflight;

  const promise = (async () => {
    const h = await ensureHighlighter();
    if (!loadedLangs.has(lang)) {
      const mod = (await LANG_LOADERS[lang]()) as { default: unknown };
      // Shiki language modules default-export a `LanguageRegistration[]`.
      await h.loadLanguage(mod.default as never);
      loadedLangs.add(lang);
    }
    return h;
  })();

  loadingByLang.set(lang, promise);
  return promise;
}

/**
 * Synchronous lookup. Returns highlighted HTML if the grammar is
 * already loaded; returns `null` otherwise so the caller can render a
 * plain `<pre><code>` fallback for this frame and kick off
 * `loadHighlighter(lang)` for the next render.
 *
 * For convenience, an unsupported `lang` also returns `null` (the
 * caller's fallback path is the same).
 */
export function highlightSync(code: string, lang: string): string | null {
  if (!isSupportedLang(lang)) return null;
  if (!highlighter) return null;
  if (!loadedLangs.has(lang)) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang: LANG_TO_REGISTERED[lang],
      theme: THEME,
    });
  } catch {
    // Shiki occasionally throws on edge inputs (e.g. extremely long
    // single-line strings during streaming). Treat as "not yet
    // renderable" — the caller's plain-pre/code fallback handles it.
    return null;
  }
}

/** Escape the five HTML-significant chars for safe interpolation into markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain `<pre><code>` fallback used when no highlighter is available yet. */
export function plainCodeBlock(code: string, lang: string): string {
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
}

// --- internals exposed for tests --------------------------------------

/** Test-only: reset module state. Not exported via the public surface. */
export function __resetForTests(): void {
  highlighterPromise = null;
  highlighter = null;
  loadingByLang.clear();
  loadedLangs.clear();
}
