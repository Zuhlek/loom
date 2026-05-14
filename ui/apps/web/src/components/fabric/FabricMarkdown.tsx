import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked, type Tokens } from "marked";
import markedShiki from "marked-shiki";
import { createRoot, type Root } from "react-dom/client";
import {
  highlightSync,
  isSupportedLang,
  loadHighlighter,
  type SupportedLang,
} from "../../lib/shiki-loader";
import { MermaidBlock } from "./MermaidBlock";

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainCodeBlock(code: string, lang: string): string {
  const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  return `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
}

const MERMAID_SOURCES = new Map<string, string>();
let mermaidSourceCounter = 0;

marked.use(
  markedShiki({
    highlight(code: string, lang: string) {
      if (!lang || lang === "mermaid") {
        if (lang === "mermaid") {
          mermaidSourceCounter += 1;
          const id = `loom-mermaid-src-${mermaidSourceCounter}`;
          MERMAID_SOURCES.set(id, code);
          return `<div class="loom-mermaid-block" data-source-id="${id}"></div>`;
        }
        return plainCodeBlock(code, lang);
      }
      if (!isSupportedLang(lang)) {
        return plainCodeBlock(code, lang);
      }
      const typedLang = lang as SupportedLang;
      const html = highlightSync(code, typedLang);
      if (html) return html;
      loadHighlighter(typedLang).catch(() => {
        /* keep the plain fallback */
      });
      return plainCodeBlock(code, lang);
    },
  }),
);

marked.use({
  extensions: [
    {
      name: "fabric-mermaid-tokenizer",
      level: "block",
      start(src: string) {
        return src.indexOf("```mermaid");
      },
      tokenizer(src: string) {
        const match = /^```mermaid\n([\s\S]*?)\n```\n?/.exec(src);
        if (!match) return undefined;
        return {
          type: "code",
          raw: match[0],
          lang: "mermaid",
          text: match[1],
        } as Tokens.Code;
      },
    },
  ],
});

export interface FabricMarkdownProps {
  source: string;
}

export function FabricMarkdown({ source }: FabricMarkdownProps) {
  const [html, setHtml] = useState<string>("");
  const [failed, setFailed] = useState<boolean>(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const rootsRef = useRef<WeakMap<Element, Root>>(new WeakMap());
  const trackedElementsRef = useRef<Set<Element>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!source) {
      setHtml("");
      return;
    }
    try {
      const result = marked.parse(source);
      Promise.resolve(result)
        .then((value) => {
          if (!cancelled) setHtml(String(value));
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    } catch {
      setFailed(true);
    }
    return () => {
      cancelled = true;
    };
  }, [source]);

  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    for (const element of trackedElementsRef.current) {
      const root = rootsRef.current.get(element);
      if (root) {
        root.unmount();
        rootsRef.current.delete(element);
      }
    }
    trackedElementsRef.current.clear();
    const placeholders = article.querySelectorAll<HTMLElement>(
      ".loom-mermaid-block",
    );
    placeholders.forEach((placeholder) => {
      const id = placeholder.dataset.sourceId;
      if (!id) return;
      const mermaidSource = MERMAID_SOURCES.get(id);
      if (mermaidSource === undefined) return;
      MERMAID_SOURCES.delete(id);
      const root = createRoot(placeholder);
      rootsRef.current.set(placeholder, root);
      trackedElementsRef.current.add(placeholder);
      root.render(<MermaidBlock source={mermaidSource} />);
    });
    return () => {
      for (const element of trackedElementsRef.current) {
        const root = rootsRef.current.get(element);
        if (root) {
          root.unmount();
          rootsRef.current.delete(element);
        }
      }
      trackedElementsRef.current.clear();
    };
  }, [html]);

  if (failed) {
    return <pre className="text-[12px] font-mono whitespace-pre-wrap">{source}</pre>;
  }
  return (
    <article
      ref={articleRef}
      className="text-sm leading-relaxed prose-loom"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const __testing = { escapeHtml };
