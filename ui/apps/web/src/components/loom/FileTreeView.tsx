export type LoomFile = {
  path: string;
  /** Relative depth (0 root) */
  depth?: number;
  active?: boolean;
  pending?: boolean;
  dimmed?: boolean;
  isDirectory?: boolean;
  expanded?: boolean;
};

export interface FileTreeViewProps {
  rootLabel: string;
  files: LoomFile[];
  onSelect?: (path: string) => void;
}

/** Static-ish file tree rendered for the loom artifact view. */
export function FileTreeView({ rootLabel, files, onSelect }: FileTreeViewProps) {
  return (
    <aside
      className="w-56 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.012)" }}
    >
      <div className="px-3 py-2.5 border-b text-xs flex items-center gap-1.5" style={{ borderColor: "var(--border)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--muted-foreground)" }}>
          <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
        <code className="font-mono">{rootLabel}</code>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 text-[12px]">
        <div className="space-y-0.5">
          {files.map((f) => {
            const indent = (f.depth ?? 0) * 12;
            return (
              <div
                key={f.path}
                onClick={() => onSelect?.(f.path)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded font-mono cursor-pointer hover:bg-[var(--accent)]"
                style={{
                  paddingLeft: 6 + indent,
                  background: f.active ? "var(--accent)" : "transparent",
                  color: f.active ? "var(--foreground)" : "var(--muted-foreground)",
                  opacity: f.dimmed ? 0.5 : 1,
                }}
              >
                {f.isDirectory && <span className="text-[10px]">{f.expanded ? "▾" : "▸"}</span>}
                <span>
                  {f.isDirectory ? "📁" : "📄"} {f.path}
                </span>
                {f.pending && <span className="ml-auto size-1.5 rounded-full awaiting-pulse" style={{ background: "var(--warning)" }} />}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
