import { useEffect, useState } from "react";
import { loadMermaid } from "../../lib/mermaid-loader";

export interface MermaidBlockProps {
  source: string;
}

let diagramCounter = 0;
function nextDiagramId(): string {
  diagramCounter += 1;
  return `loom-mermaid-${diagramCounter}`;
}

export function MermaidBlock({ source }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then(async (mermaid) => {
        try {
          const { svg: rendered } = await mermaid.render(nextDiagramId(), source);
          if (!cancelled) setSvg(rendered);
        } catch {
          if (!cancelled) setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (failed) {
    return (
      <>
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
        <span
          className="text-[10px]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Mermaid: could not render diagram.
        </span>
      </>
    );
  }
  if (svg) {
    return (
      <div className="loom-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
    );
  }
  return <div className="loom-mermaid" aria-busy="true" />;
}
