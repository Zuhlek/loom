/**
 * Markdown renderer for assistant messages.
 *
 * Uses `marked` with the `marked-shiki` extension to syntax-highlight
 * fenced code blocks. Grammars in the curated subset (TS/TSX/JS/JSX/
 * Python/Bash/Sh/JSON/MD/HTML/CSS) are lazy-loaded on first use via
 * `lib/shiki-loader.ts`; everything else falls back to plain
 * `<pre><code>` rendering. See Design ADR-005 for the integration shape
 * and Spec ## Constraints for the trust-boundary policy.
 *
 * Async note: `marked-shiki` sets `async: true` on its extension, so
 * `marked.parse(text)` returns a Promise. We bridge it back to the
 * synchronous JSX render by holding the latest parsed HTML in state
 * and updating it from a `useEffect` per text-delta. The streaming
 * caret element lives OUTSIDE the parsed HTML so it keeps rendering
 * correctly while the parse promise is still in-flight.
 *
 * Trust model: assistant output is rendered as HTML. `marked` is
 * invoked with `gfm` and `breaks` enabled; raw-HTML passthrough MUST
 * NOT be enabled (Spec ## Constraints — see test enforcement).
 */
import { useEffect, useState } from "react";
import { marked } from "marked";
import markedShiki from "marked-shiki";
import {
  escapeHtml,
  highlightSync,
  isSupportedLang,
  loadHighlighter,
  plainCodeBlock,
  type SupportedLang,
} from "../../lib/shiki-loader";

// Module-scope marked configuration (ADR-005: `marked.use(...)` runs
// once per import). Order matters: setOptions first, then use().
marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use(
  markedShiki({
    highlight(code, lang) {
      // Unknown / blank lang → plain pre/code fallback. AC2.
      if (!lang || !isSupportedLang(lang)) {
        return plainCodeBlock(code, lang);
      }
      const typedLang = lang as SupportedLang;
      const html = highlightSync(code, typedLang);
      if (html) return html;
      // Grammar not loaded yet. Kick off the lazy load so the NEXT
      // render picks it up (AC3); render plain for this frame.
      loadHighlighter(typedLang).catch(() => {
        // Network / bundle-strip failure: keep the plain fallback —
        // do NOT throw out of marked.parse (Design ## Failure modes).
      });
      return plainCodeBlock(code, lang);
    },
  }),
);

interface Props {
  text: string;
  isStreaming?: boolean;
}

export function ChatMarkdown({ text, isStreaming }: Props) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    // marked-shiki forces async walkTokens, so marked.parse is async.
    Promise.resolve(marked.parse(text))
      .then((result) => {
        if (!cancelled) setHtml(String(result));
      })
      .catch(() => {
        // marked itself should never throw on assistant text, but if
        // it does fall back to the raw escaped text so the message is
        // still readable.
        if (!cancelled) setHtml(escapeHtml(text));
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <div
      className="chat-markdown text-sm leading-relaxed"
      dangerouslySetInnerHTML={{
        __html:
          html +
          (isStreaming ? "<span class=\"streaming-caret\">▍</span>" : ""),
      }}
    />
  );
}
