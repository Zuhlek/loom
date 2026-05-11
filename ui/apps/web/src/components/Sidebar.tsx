import { Link } from "wouter";
import clsx from "clsx";

export type ChatRow = {
  id: string;
  label: string;
  href?: string;
  active?: boolean;
  /** Visual permission-mode dot color: green = default, blue = accept-edits, amber = bypass */
  permissionDot?: "default" | "accept-edits" | "bypass";
  /** Show the worktree glyph */
  worktree?: boolean;
  /** Show the awaiting-input pulse */
  awaitingInput?: boolean;
  /** Optional subtitle line, e.g. cwd disambiguator */
  subtitle?: string;
};

export type LoomRow = {
  id: string;
  label: string;
  href?: string;
  active?: boolean;
  /** P0 / P1 / P2 / P2.5 / P3 / P4 / done */
  phase?: string;
  /** green dot if done */
  done?: boolean;
  subtitle?: string;
};

export type ProjectGroup = {
  id: string;
  label: string;
  initial: string;
  /** Tailwind color name (e.g. emerald, indigo, amber) */
  accent?: string;
  count?: number;
  collapsed?: boolean;
  chats?: ChatRow[];
  looms?: LoomRow[];
};

export interface SidebarProps {
  chatGroups?: ProjectGroup[];
  loomGroups?: ProjectGroup[];
  flatChats?: ChatRow[];
  flatLooms?: LoomRow[];
  emptyChats?: boolean;
  emptyLooms?: boolean;
  onContextMenu?: (chatId: string, evt: React.MouseEvent) => void;
}

const DOT_COLOR: Record<NonNullable<ChatRow["permissionDot"]>, string> = {
  default: "bg-emerald-500",
  "accept-edits": "bg-blue-500",
  bypass: "bg-amber-500",
};

function ChatRowView({ row, onContextMenu }: { row: ChatRow; onContextMenu?: SidebarProps["onContextMenu"] }) {
  const body = (
    <div
      onContextMenu={(e) => onContextMenu?.(row.id, e)}
      className={clsx(
        "flex items-center gap-1.5 px-2 py-1 ml-3 rounded-md text-xs cursor-pointer",
        row.active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
    >
      <span className={clsx("size-1.5 rounded-full shrink-0", DOT_COLOR[row.permissionDot ?? "default"])} />
      <span className="flex-1 truncate">{row.label}</span>
      {row.worktree ? <span className="text-[10px] text-[var(--muted-foreground)] font-mono">⎇</span> : null}
      {row.awaitingInput ? (
        <span className="size-1.5 rounded-full bg-amber-500 awaiting-pulse" title="Awaiting input" />
      ) : null}
    </div>
  );
  return row.href ? <Link href={row.href}>{body}</Link> : body;
}

function LoomRowView({ row }: { row: LoomRow }) {
  const body = (
    <div
      className={clsx(
        "flex items-center gap-1.5 px-2 py-1 ml-3 rounded-md text-xs cursor-pointer",
        row.active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
    >
      {row.phase ? (
        <span className="text-[9px] font-mono px-1 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
          {row.phase}
        </span>
      ) : null}
      <span className="flex-1 truncate">{row.label}</span>
      {row.done ? <span className="size-1.5 rounded-full bg-emerald-500" title="Phase complete" /> : null}
    </div>
  );
  return row.href ? <Link href={row.href}>{body}</Link> : body;
}

function ProjectGroupView({ group }: { group: ProjectGroup }) {
  const accent = group.accent ?? "emerald";
  return (
    <div className="mb-1">
      <div className="group flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--accent)] cursor-pointer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5 text-[var(--muted-foreground)]">
          <path d={group.collapsed ? "M9 6l6 6-6 6" : "M6 9l6 6 6-6"} />
        </svg>
        <div
          className={clsx(
            "size-4 rounded-sm grid place-items-center text-[9px] font-bold",
            `bg-${accent}-500/15 text-${accent}-700`,
          )}
        >
          {group.initial}
        </div>
        <span className="text-xs font-medium flex-1 truncate">{group.label}</span>
        {group.count != null ? (
          <span className="text-[10px] text-[var(--muted-foreground)]">{group.count}</span>
        ) : null}
      </div>
      {!group.collapsed && (
        <>
          {(group.chats ?? []).map((c) => (
            <ChatRowView key={c.id} row={c} />
          ))}
          {(group.looms ?? []).map((f) => (
            <LoomRowView key={f.id} row={f} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Two-section sidebar: Chats and Looms.
 * Modeled on t3code's Sidebar.tsx but rewritten for nora's grouping (SR-37).
 */
export function Sidebar(props: SidebarProps) {
  const { chatGroups, loomGroups, flatChats, flatLooms, emptyChats, emptyLooms, onContextMenu } = props;
  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      {/* Branding header */}
      <div className="flex items-center justify-between px-3 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-6" style={{ color: "var(--primary)" }} aria-hidden>
            <path d="M3 6 C 6 4, 9 8, 12 6 S 18 4, 21 6 L 21 18 C 18 16, 15 20, 12 18 S 6 16, 3 18 Z" />
          </svg>
          <span className="text-sm font-medium">loom</span>
        </div>
        <Link href="/spawn">
          <button
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="New chat"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </Link>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: "var(--muted)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--muted-foreground)" }}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search chats and looms"
            className="flex-1 bg-transparent outline-none text-xs placeholder:text-[var(--muted-foreground)]/60"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {/* Chats section */}
        <div className="px-1.5 pt-1 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: "var(--muted-foreground)" }}>
            Chats
          </span>
          <Link href="/spawn">
            <button className="text-[10px] hover:text-[var(--foreground)]" style={{ color: "var(--muted-foreground)" }}>
              +
            </button>
          </Link>
        </div>

        {emptyChats ? (
          <div className="px-2 py-3 mx-1.5 rounded-md border border-dashed text-center" style={{ borderColor: "var(--border)" }}>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              No chats yet.
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Spawn one to begin.
            </p>
          </div>
        ) : (
          <>
            {(flatChats ?? []).map((c) => (
              <ChatRowView key={c.id} row={c} onContextMenu={onContextMenu} />
            ))}
            {(chatGroups ?? []).map((g) => (
              <ProjectGroupView key={g.id} group={g} />
            ))}
          </>
        )}

        {/* Looms section */}
        <div className="px-1.5 pt-4 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: "var(--muted-foreground)" }}>
            Looms
          </span>
        </div>

        {emptyLooms ? (
          <div className="px-2 py-3 mx-1.5 rounded-md border border-dashed text-center" style={{ borderColor: "var(--border)" }}>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              No looms yet.
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Run <code className="font-mono">/weave</code> in any chat.
            </p>
          </div>
        ) : (
          <>
            {(flatLooms ?? []).map((f) => (
              <LoomRowView key={f.id} row={f} />
            ))}
            {(loomGroups ?? []).map((g) => (
              <ProjectGroupView key={g.id} group={g} />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-2.5 py-2 flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <Link href="/settings">
          <button
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 014 17.93l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9.9a1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 016.07 4l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 009.1 2.91V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06A2 2 0 0119.93 7l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.27.66.92 1.09 1.65 1.09H21a2 2 0 010 4h-.09c-.73 0-1.38.43-1.65 1.09z" />
            </svg>
          </button>
        </Link>
        <span className="size-1.5 rounded-full" style={{ background: "var(--success)" }} />
        <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          Connected · localhost:7891
        </span>
      </div>
    </aside>
  );
}
