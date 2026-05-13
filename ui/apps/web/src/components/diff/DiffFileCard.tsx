/*
 * DiffFileCard — per-file diff card (header row + collapsible hunks).
 *
 * Lifted from `DiffPanel.tsx` (formerly the inlined JSX inside
 * `DiffPanel`'s `files.map(...)` body) with three additions:
 *   1. Internal collapse state owned by the card itself.
 *   2. Chevron toggle wired to the collapse setter.
 *   3. Optional `maxHeight` applied to the hunks container as an
 *      inline style (used by the slim Edit/Write approval variant in
 *      `InlineEditDiff`).
 *
 * Status badge palette (STATUS_BG / STATUS_FG) lifted from `DiffPanel.tsx`
 * during the T-002 extract; the card module now owns the constants.
 */
import { useState } from "react";
import clsx from "clsx";

import type { DiffFile, DiffLine, DiffStatus } from "./DiffPanel";

export interface DiffFileCardProps {
  file: DiffFile;
  defaultCollapsed?: boolean;
  maxHeight?: string;
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

function DiffLineRow({ line }: { line: DiffLine }) {
  const cls =
    line.kind === "meta"
      ? "diff-meta italic px-2"
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

export function DiffFileCard({ file, defaultCollapsed, maxHeight }: DiffFileCardProps) {
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed ?? false);
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div
        className="px-3 py-1.5 flex items-center gap-2 border-b text-[11px]"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="size-4 grid place-items-center rounded hover:bg-[var(--accent)]"
          style={{ color: "var(--muted-foreground)" }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand file" : "Collapse file"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={clsx("size-3 transition-transform", collapsed ? "-rotate-90" : "")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span
          className="text-[10px] uppercase tracking-wide font-medium px-1 rounded"
          style={{ background: STATUS_BG[file.status], color: STATUS_FG[file.status] }}
        >
          {file.status}
        </span>
        <code className="font-mono">{file.path}</code>
        <span className="ml-auto">
          {file.added > 0 && <span style={{ color: "var(--success)" }}>+{file.added}</span>}
          {file.added > 0 && file.removed > 0 && " "}
          {file.removed > 0 && <span style={{ color: "var(--destructive)" }}>−{file.removed}</span>}
        </span>
      </div>
      {!collapsed && (
        <pre
          className="text-[11px] font-mono leading-relaxed overflow-x-auto"
          style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
        >
          <code>
            {file.hunks.flat().map((line, i) => (
              <DiffLineRow key={i} line={line} />
            ))}
          </code>
        </pre>
      )}
    </div>
  );
}
