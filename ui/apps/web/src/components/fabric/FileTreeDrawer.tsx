import { FabricFileTree, type FabricTreeEntry } from "./FabricFileTree";

export interface FileTreeDrawerProps {
  rootLabel: string;
  tree: FabricTreeEntry[];
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onRefresh: () => void;
}

export function FileTreeDrawer({
  rootLabel,
  tree,
  artifacts,
  selectedPath,
  onSelect,
  onRefresh,
}: FileTreeDrawerProps) {
  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-l"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
      data-testid="fabric-file-tree-drawer"
    >
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <span
          className="text-[10px] font-semibold tracking-wider"
          style={{ color: "var(--muted-foreground)" }}
        >
          {rootLabel.toUpperCase()}
        </span>
        <button
          type="button"
          data-testid="fabric-refresh"
          onClick={onRefresh}
          className="size-5 grid place-items-center rounded hover:bg-[var(--accent)]"
          title="Refresh now"
          aria-label="Refresh fabric"
          style={{ color: "var(--muted-foreground)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <path d="M3 12a9 9 0 0115.3-6.4L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 01-15.3 6.4L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1 text-[11px]">
        <FabricFileTree
          tree={tree}
          artifacts={artifacts}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
