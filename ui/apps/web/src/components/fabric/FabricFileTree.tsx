import { useCallback, useMemo, useState } from "react";
import {
  PHASE_GROUP_META,
  PHASE_GROUP_ORDER,
  PIPELINE_PATH,
  partitionByPhase,
  type PhaseGroupId,
} from "./fabric-phase-files";

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
  const buckets = useMemo(() => partitionByPhase(tree), [tree]);
  const pipelineEntry = useMemo(
    () => tree.find((e) => !e.isDirectory && e.path === PIPELINE_PATH) ?? null,
    [tree],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    initialCollapsedFromTree(tree),
  );
  const toggle = useCallback(
    (path: string) =>
      setCollapsed((map) => ({ ...map, [path]: !(map[path] ?? true) })),
    [],
  );
  const [phasesCollapsed, setPhasesCollapsed] = useState<
    Record<PhaseGroupId, boolean>
  >(() => ({
    spec: false,
    design: false,
    plan: false,
    build: false,
    review: false,
    misc: false,
  }));
  const togglePhase = useCallback(
    (id: PhaseGroupId) =>
      setPhasesCollapsed((map) => ({ ...map, [id]: !map[id] })),
    [],
  );
  return (
    <>
      {pipelineEntry && (
        <PipelineRow
          entry={pipelineEntry}
          artifacts={artifacts}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      )}
      {PHASE_GROUP_ORDER.map((id) => {
        const entries = buckets[id];
        if (entries.length === 0) return null;
        return (
          <PhaseSection
            key={id}
            id={id}
            entries={entries}
            open={!phasesCollapsed[id]}
            onTogglePhase={togglePhase}
            collapsed={collapsed}
            toggle={toggle}
            artifacts={artifacts}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        );
      })}
    </>
  );
}

interface PipelineRowProps {
  entry: FabricTreeEntry;
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function PipelineRow({
  entry,
  artifacts,
  selectedPath,
  onSelect,
}: PipelineRowProps) {
  const isReadable = artifacts[entry.path] != null;
  const isActive = entry.path === selectedPath;
  return (
    <div
      data-testid={`fabric-file-row-${entry.path}`}
      data-selected={isActive ? "true" : undefined}
      data-readable={isReadable ? "true" : "false"}
      onClick={() => {
        if (isReadable) onSelect(entry.path);
      }}
      className="flex items-center gap-1.5 rounded px-1 py-1 mb-1 select-none"
      style={{
        background: isActive
          ? "var(--selected-row)"
          : "rgba(59,130,246,0.08)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "var(--border)",
        color: isReadable ? "var(--foreground)" : "var(--muted-foreground)",
        cursor: isReadable ? "pointer" : "default",
        opacity: isReadable ? 1 : 0.55,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="size-3.5 shrink-0"
        style={{ color: "var(--info)" }}
        aria-hidden
      >
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 6h8M6 8v8M18 8v8M8 18h8" strokeLinecap="round" />
      </svg>
      <span className="truncate flex-1 text-[11px] font-medium">
        {entry.name}
      </span>
      <span
        className="text-[9px] tabular-nums"
        style={{ color: "var(--muted-foreground)" }}
      >
        {humanSize(entry.size)}
      </span>
    </div>
  );
}

interface PhaseSectionProps {
  id: PhaseGroupId;
  entries: FabricTreeEntry[];
  open: boolean;
  onTogglePhase: (id: PhaseGroupId) => void;
  collapsed: Record<string, boolean>;
  toggle: (path: string) => void;
  artifacts: Record<string, string>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function PhaseSection({
  id,
  entries,
  open,
  onTogglePhase,
  collapsed,
  toggle,
  artifacts,
  selectedPath,
  onSelect,
}: PhaseSectionProps) {
  const meta = PHASE_GROUP_META[id];
  const roots = useMemo(() => buildTree(entries), [entries]);
  const fileCount = useMemo(
    () => entries.filter((e) => !e.isDirectory).length,
    [entries],
  );
  const isMisc = id === "misc";
  return (
    <div data-testid={`fabric-phase-group-${id}`} className="mb-1">
      <button
        type="button"
        onClick={() => onTogglePhase(id)}
        aria-expanded={open}
        data-testid={`fabric-phase-header-${id}`}
        className="w-full flex items-center gap-1.5 px-1 py-1 rounded select-none"
        style={{
          background: isMisc ? "rgba(245,158,11,0.10)" : "transparent",
        }}
      >
        <ChevronIcon open={open} />
        {meta.num ? (
          <span
            className="size-3.5 rounded-full grid place-items-center text-[9px] font-bold shrink-0"
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
            }}
          >
            {meta.num}
          </span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="size-3.5 shrink-0"
            style={{ color: "var(--warning)" }}
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.8" fill="currentColor" />
          </svg>
        )}
        <span
          className="text-[11px] font-medium flex-1 text-left"
          style={{
            color: isMisc
              ? "var(--warning-foreground)"
              : "var(--foreground)",
          }}
        >
          {meta.num ? `P${meta.num} ${meta.label}` : meta.label}
        </span>
        <span
          className="text-[9px] tabular-nums"
          style={{ color: "var(--muted-foreground)" }}
        >
          {fileCount}
        </span>
      </button>
      {open &&
        roots.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={1}
            collapsed={collapsed}
            toggle={toggle}
            artifacts={artifacts}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
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
