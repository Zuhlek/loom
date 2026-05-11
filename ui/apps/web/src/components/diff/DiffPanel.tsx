/*
 * DiffPanel — split-pane diff for worktree-mode chats.
 *
 * Adapted (shape and Tailwind classnames) from t3code's DiffPanel.tsx + DiffPanelShell.tsx
 * (apps/web/src/components/diff/) which is MIT-licensed. The data flow has been simplified
 * to plain props (no Effect runtime) for the Phase 4 mockup pages.
 */

import { useState } from "react";
import clsx from "clsx";

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

const STATUS_BG: Record<DiffStatus, string> = {
  added: "rgba(16,185,129,0.18)",
  modified: "rgba(245,158,11,0.18)",
  deleted: "rgba(239,68,68,0.18)",
  renamed: "rgba(59,130,246,0.18)",
};

const STATUS_FG: Record<DiffStatus, string> = {
  added: "var(--success-foreground)",
  modified: "var(--warning-foreground)",
  deleted: "var(--destructive-foreground)",
  renamed: "var(--info-foreground)",
};

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

export interface DiffPanelProps {
  files: DiffFile[];
  scope: "per-turn" | "whole";
  onScopeChange?: (next: "per-turn" | "whole") => void;
  /** Subtitle right-side, e.g. "turn 4 of 7" */
  scopeSubtitle?: string;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const cls =
    line.kind === "meta"
      ? "diff-meta px-2"
      : line.kind === "add"
      ? "diff-add px-2"
      : line.kind === "del"
      ? "diff-del px-2"
      : "px-2";
  return (
    <div className={cls}>
      {line.kind === "add" && <span className="diff-add-strong px-0.5">+</span>}
      {line.kind === "del" && <span className="diff-del-strong px-0.5">-</span>}
      {line.text}
    </div>
  );
}

export function DiffPanel({ files, scope, onScopeChange, scopeSubtitle }: DiffPanelProps) {
  const totalAdd = files.reduce((s, f) => s + f.added, 0);
  const totalDel = files.reduce((s, f) => s + f.removed, 0);
  return (
    <>
      <div className="border-b px-3 py-1.5 flex items-center gap-2" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
        <div className="inline-flex p-0.5 rounded-md border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <button
            onClick={() => onScopeChange?.("per-turn")}
            className={clsx("px-2.5 py-0.5 rounded text-[11px]", scope === "per-turn" ? "font-medium" : "")}
            style={
              scope === "per-turn"
                ? { background: "var(--background)", color: "var(--foreground)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }
                : { color: "var(--muted-foreground)" }
            }
          >
            Per-turn
          </button>
          <button
            onClick={() => onScopeChange?.("whole")}
            className={clsx("px-2.5 py-0.5 rounded text-[11px]", scope === "whole" ? "font-medium" : "")}
            style={
              scope === "whole"
                ? { background: "var(--background)", color: "var(--foreground)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }
                : { color: "var(--muted-foreground)" }
            }
          >
            Whole conversation
          </button>
        </div>
        {scopeSubtitle && (
          <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
            {scopeSubtitle}
          </span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          {files.length} files · <span style={{ color: "var(--success)" }}>+{totalAdd}</span>{" "}
          <span style={{ color: "var(--destructive)" }}>−{totalDel}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ background: "rgba(0,0,0,0.012)" }}>
        {files.map((file) => (
          <div key={file.path} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="px-3 py-1.5 flex items-center gap-2 border-b text-[11px]" style={{ borderColor: "var(--border)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3" style={{ color: "var(--muted-foreground)" }}>
                <path d="M6 9l6 6 6-6" transform="rotate(-90 12 12)" />
              </svg>
              <span className="text-[10px] uppercase tracking-wide font-medium px-1 rounded" style={{ background: STATUS_BG[file.status], color: STATUS_FG[file.status] }}>
                {file.status}
              </span>
              <code className="font-mono">{file.path}</code>
              <span className="ml-auto">
                {file.added > 0 && <span style={{ color: "var(--success)" }}>+{file.added}</span>}
                {file.added > 0 && file.removed > 0 && " "}
                {file.removed > 0 && <span style={{ color: "var(--destructive)" }}>−{file.removed}</span>}
              </span>
            </div>
            <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto">
              <code>
                {file.hunks.flat().map((line, i) => (
                  <DiffLineRow key={i} line={line} />
                ))}
              </code>
            </pre>
          </div>
        ))}
      </div>
    </>
  );
}

export function DiffPanelShell({
  branchToolbar,
  diffProps,
}: {
  branchToolbar: BranchToolbarProps;
  diffProps: Omit<DiffPanelProps, "scope" | "onScopeChange">;
}) {
  const [scope, setScope] = useState<"per-turn" | "whole">("per-turn");
  return (
    <aside className="w-[44vw] min-w-[420px] max-w-[640px] shrink-0 flex flex-col border-l" style={{ borderColor: "var(--border)" }}>
      <BranchToolbar {...branchToolbar} />
      <DiffPanel {...diffProps} scope={scope} onScopeChange={setScope} />
    </aside>
  );
}
