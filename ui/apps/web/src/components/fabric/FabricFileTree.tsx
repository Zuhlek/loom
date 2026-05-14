import { useCallback, useMemo, useState } from "react";

export interface FabricTreeEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

export interface FabricFileTreeProps {
  tree: FabricTreeEntry[];
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: TreeNode[];
}

function buildTree(entries: FabricTreeEntry[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (const entry of sorted) {
    const node: TreeNode = {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      size: entry.size,
      children: [],
    };
    byPath.set(entry.path, node);
    const slashIdx = entry.path.lastIndexOf("/");
    if (slashIdx < 0) {
      roots.push(node);
    } else {
      const parent = byPath.get(entry.path.slice(0, slashIdx));
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  return roots;
}

function initialCollapsedFromTree(
  tree: FabricTreeEntry[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const entry of tree) {
    if (entry.isDirectory) out[entry.path] = true;
  }
  return out;
}

export function FabricFileTree({
  tree,
  artifacts,
  selectedPath,
  onSelect,
}: FabricFileTreeProps) {
  const roots = useMemo(() => buildTree(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    initialCollapsedFromTree(tree),
  );
  const toggle = useCallback(
    (path: string) => setCollapsed((map) => ({ ...map, [path]: !(map[path] ?? true) })),
    [],
  );
  return (
    <>
      {roots.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          artifacts={artifacts}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  collapsed: Record<string, boolean>;
  toggle: (path: string) => void;
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeRow({
  node,
  depth,
  collapsed,
  toggle,
  artifacts,
  selectedPath,
  onSelect,
}: TreeRowProps) {
  const isOpen = collapsed[node.path] === false;
  const isFile = !node.isDirectory;
  const isReadable = isFile && artifacts[node.path] != null;
  const isActive = isFile && node.path === selectedPath;
  return (
    <>
      <div
        data-testid={isFile ? `fabric-file-row-${node.path}` : undefined}
        data-selected={isActive ? "true" : undefined}
        data-readable={isFile ? (isReadable ? "true" : "false") : undefined}
        onClick={() => {
          if (node.isDirectory) toggle(node.path);
          else if (isReadable) onSelect(node.path);
        }}
        className="flex items-center gap-1 rounded px-1 py-[2px] select-none"
        style={{
          paddingLeft: 4 + depth * 10,
          background: isActive ? "var(--selected-row)" : "transparent",
          color: isActive
            ? "var(--foreground)"
            : isReadable || node.isDirectory
              ? "var(--foreground)"
              : "var(--muted-foreground)",
          cursor: node.isDirectory || isReadable ? "pointer" : "default",
          opacity: isFile && !isReadable ? 0.55 : 1,
        }}
      >
        {node.isDirectory ? (
          <ChevronIcon open={isOpen} />
        ) : (
          <span className="inline-block w-2.5" />
        )}
        {node.isDirectory ? (
          <FolderIcon open={isOpen} />
        ) : (
          <FileIcon name={node.name} />
        )}
        <span className="truncate flex-1">{node.name}</span>
        {isFile && (
          <span
            className="text-[9px] tabular-nums"
            style={{ color: "var(--muted-foreground)" }}
          >
            {humanSize(node.size)}
          </span>
        )}
      </div>
      {node.isDirectory &&
        isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            toggle={toggle}
            artifacts={artifacts}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="size-2.5 shrink-0 transition-transform"
      style={{
        color: "var(--muted-foreground)",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
      }}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="size-3.5 shrink-0"
      style={{ color: open ? "var(--info)" : "var(--muted-foreground)" }}
      aria-hidden
    >
      {open ? (
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1H5l-2 9V7z" strokeLinejoin="round" />
      ) : (
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const tint =
    ext === "md"
      ? "var(--info)"
      : ext === "json" || ext === "jsonl"
        ? "var(--warning)"
        : ext === "sh"
          ? "var(--success)"
          : "var(--muted-foreground)";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="size-3.5 shrink-0"
      style={{ color: tint }}
      aria-hidden
    >
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" strokeLinejoin="round" />
      <path d="M14 3v6h6" strokeLinejoin="round" />
    </svg>
  );
}

function humanSize(value: number): string {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}K`;
  return `${(value / 1024 / 1024).toFixed(1)}M`;
}
