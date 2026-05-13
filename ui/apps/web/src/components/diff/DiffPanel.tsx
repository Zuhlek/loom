/*
 * Diff shared surface — types and BranchToolbar for worktree-mode chats.
 *
 * Adapted (shape and Tailwind classnames) from t3code's DiffPanel.tsx
 * (apps/web/src/components/diff/) which is MIT-licensed. The DiffPanel /
 * DiffPanelShell components were removed in cleanup (R-002) — DiffPanelContainer
 * owns the production composition and the mockup-page consumers ADR-6
 * anticipated never materialised. This module exports the shared diff types
 * and the BranchToolbar primitive only.
 */

export type DiffStatus = "added" | "modified" | "deleted" | "renamed";

export type DiffLine =
  | { kind: "meta"; text: string }
  | { kind: "context"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string };

export type DiffFile = {
  path: string;
  status: DiffStatus;
  added: number;
  removed: number;
  hunks: DiffLine[][];
};

export interface BranchToolbarProps {
  branch: string;
  base: string;
  uncommitted?: boolean;
  ahead?: number;
  behind?: number;
  onCommit?: () => void;
  onCommitPush?: () => void;
  onCreatePr?: () => void;
  onRefresh?: () => void;
  remote?: string;
}

export function BranchToolbar(props: BranchToolbarProps) {
  const { branch, base, uncommitted, onCommit, onCommitPush, onCreatePr, onRefresh, remote } = props;
  return (
    <div className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--muted-foreground)" }}>
            <path d="M6 3v12M18 9V21M6 15l12-6" />
          </svg>
          <code className="font-mono font-medium">{branch}</code>
        </div>
        <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          ←
        </span>
        <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          <span>base:</span>
          <code className="font-mono">{base}</code>
        </div>
        {uncommitted && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.12)", color: "var(--warning-foreground)" }}>
            <span className="size-1.5 rounded-full" style={{ background: "var(--warning)" }} />
            uncommitted
          </span>
        )}
      </div>
      <div className="px-3 pb-2 flex items-center gap-1">
        <button onClick={onCommit} className="px-2 py-1 rounded-md text-[11px] font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
          Commit
        </button>
        <button
          onClick={onCommitPush}
          className="px-2 py-1 rounded-md text-[11px] font-medium border hover:bg-[var(--accent)] inline-flex items-center gap-1"
          style={{ borderColor: "var(--border)" }}
        >
          Commit & push
          {remote && (
            <span className="text-[9px] font-mono px-1 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              {remote}
            </span>
          )}
        </button>
        <button onClick={onCreatePr} className="px-2 py-1 rounded-md text-[11px] font-medium text-white inline-flex items-center gap-1" style={{ background: "var(--primary)" }}>
          Create PR
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
            <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
          </svg>
        </button>
        <span className="ml-auto" />
        <button onClick={onRefresh} className="size-6 rounded grid place-items-center hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }} title="Refresh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
            <path d="M3 12a9 9 0 0115-6.7L21 8M21 4v4h-4M21 12a9 9 0 01-15 6.7L3 16M3 20v-4h4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
