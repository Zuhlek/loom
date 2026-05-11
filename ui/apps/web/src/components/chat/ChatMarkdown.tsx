/**
 * Markdown renderer for assistant messages.
 *
 * Minimal port of t3code's ChatMarkdown: we use `marked` (already in
 * deps) to convert the text to HTML once per render and inject it via
 * dangerouslySetInnerHTML. Streaming works naturally because the parent
 * passes the cumulative `text` each render; marked is fast enough to
 * re-run on every delta for typical message sizes.
 *
 * Trust model: assistant output is rendered as HTML. Marked is invoked
 * with default settings (no raw-HTML pass-through) so the only HTML we
 * inject comes from marked's own renderers — safe for assistant text.
 */
import { useMemo } from "react";
import { marked } from "marked";

interface Props {
  text: string;
  isStreaming?: boolean;
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function ChatMarkdown({ text, isStreaming }: Props) {
  const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
  return (
    <div
      className="chat-markdown text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html + (isStreaming ? "<span class=\"streaming-caret\">▍</span>" : "") }}
    />
  );
}
