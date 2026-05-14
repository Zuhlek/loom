import { FabricFileTree, type FabricTreeEntry } from "./FabricFileTree";

export interface FileTreeDrawerProps {
  tree: FabricTreeEntry[];
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileTreeDrawer({
  tree,
  artifacts,
  selectedPath,
  onSelect,
}: FileTreeDrawerProps) {
  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-l"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
      data-testid="fabric-file-tree-drawer"
    >
      <div className="flex-1 overflow-y-auto px-1 py-2 text-[11px]">
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
