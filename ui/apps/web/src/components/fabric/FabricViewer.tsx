import { FabricMarkdown } from "./FabricMarkdown";
import { JsonView } from "./JsonView";

export interface FabricViewerProps {
  path: string;
  content: string | undefined;
}

export function FabricViewer({ path, content }: FabricViewerProps) {
  if (content === undefined) {
    return (
      <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
        No content available for {path}.
      </p>
    );
  }
  if (path.endsWith(".md")) {
    return <FabricMarkdown source={content} />;
  }
  if (path.endsWith(".json")) {
    return <JsonView source={content} />;
  }
  if (path.endsWith(".txt")) {
    return <pre className="text-[12px] font-mono whitespace-pre-wrap">{content}</pre>;
  }
  return <pre className="text-[12px] font-mono whitespace-pre-wrap">{content}</pre>;
}
