import { useEffect, useState } from "react";
import { highlightSync, loadHighlighter } from "../../lib/shiki-loader";

export interface JsonViewProps {
  source: string;
}

function prettyPrint(source: string): string | null {
  try {
    const parsed = JSON.parse(source);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

export function JsonView({ source }: JsonViewProps) {
  const pretty = prettyPrint(source);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(() =>
    pretty != null ? highlightSync(pretty, "json") : null,
  );

  useEffect(() => {
    if (pretty == null) {
      setHighlightedHtml(null);
      return;
    }
    const immediate = highlightSync(pretty, "json");
    if (immediate) {
      setHighlightedHtml(immediate);
      return;
    }
    let cancelled = false;
    loadHighlighter("json")
      .then(() => {
        if (cancelled) return;
        const html = highlightSync(pretty, "json");
        if (html) setHighlightedHtml(html);
      })
      .catch(() => {
        /* fall through to plain pretty-print */
      });
    return () => {
      cancelled = true;
    };
  }, [pretty]);

  if (pretty == null) {
    return (
      <pre className="text-[12px] font-mono whitespace-pre-wrap">{source}</pre>
    );
  }
  if (highlightedHtml) {
    return (
      <div
        className="text-[12px] font-mono"
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    );
  }
  return <pre className="text-[12px] font-mono whitespace-pre-wrap">{pretty}</pre>;
}
