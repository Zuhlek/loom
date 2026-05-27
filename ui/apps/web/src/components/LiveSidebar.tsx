/**
 * LiveSidebar — pulls /api/sidebar/state via SidebarStateProvider and
 * renders chats grouped by project (plus an Unassigned bucket).
 *
 * Project-first flow: the two header "+" buttons open the new-project
 * dialog; per-project hover affordance opens the spawn-chat dialog with
 * the project pre-filled. Unassigned chats are still surfaced (legacy
 * bucket) but the UI doesn't expose creating one.
 */
import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useSidebarState } from "../lib/sidebar-state";
import { useUnreadChats } from "../lib/unread-chats";
import { SpawnChatModalLive } from "../routes/spawn-chat-dialog-live";
import { NewProjectDialog } from "./NewProjectDialog";
import { ChatContextMenu } from "./sidebar/ChatContextMenu";
import {
  archiveFabric,
  deleteChat,
  deleteProject,
  forkChat,
  handoffChat,
  renameChat,
  type ApiChat,
  type ApiProject,
  type ChatLiveState,
  type SidebarFabricEntry,
} from "../lib/api";
import { FabricArchiveDialog } from "./fabric/FabricArchiveDialog";
import clsx from "clsx";

interface ContextMenuState {
  chat: ApiChat;
  x: number;
  y: number;
}

const DOT_FOR_MODE: Record<ApiChat["permission_mode"], string> = {
  default: "bg-emerald-500",
  plan: "bg-blue-500",
  acceptEdits: "bg-amber-500",
  bypassPermissions: "bg-red-500",
};

/**
 * Phase → dot color for fabrics in the sidebar. The scale runs red →
 * green across the five `/weave` phases, mirroring the user's mental
 * model of "early/risky" to "almost shipped". A `lifecycle === "complete"`
 * fabric overrides this with gray regardless of phase. Unknown / missing
 * phase falls back to a muted gray.
 */
const DOT_FOR_PHASE: Record<string, string> = {
  spec: "bg-red-500",
  design: "bg-orange-500",
  plan: "bg-amber-500",
  build: "bg-lime-500",
  review: "bg-emerald-500",
};

function fabricDotClass(
  phase: string | null | undefined,
  lifecycle: string | null | undefined,
): string {
  if (lifecycle === "complete") return "bg-gray-400";
  if (phase && DOT_FOR_PHASE[phase]) return DOT_FOR_PHASE[phase];
  return "bg-gray-300";
}

export function LiveSidebar() {
  const { state, error, refresh } = useSidebarState();
  const { isUnread, markRead } = useUnreadChats();
  const [location, navigate] = useLocation();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [spawnFor, setSpawnFor] = useState<ApiProject | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set());
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const groups = state?.groups ?? [];
  const unassigned = state?.unassigned ?? [];
  const empty = !state || (groups.length === 0 && unassigned.length === 0);

  const onContextMenu = (chat: ApiChat, evt: React.MouseEvent) => {
    evt.preventDefault();
    setContextMenu({ chat, x: evt.clientX, y: evt.clientY });
  };

  const onHandoff = async (chat: ApiChat) => {
    setContextMenu(null);
    try {
      await handoffChat(chat.id);
      setDetachedIds((prev) => {
        const next = new Set(prev);
        next.add(chat.id);
        return next;
      });
    } catch (err) {
      console.warn("[loom] handoffChat failed", err);
    }
  };

  const onFork = async (chat: ApiChat) => {
    setContextMenu(null);
    try {
      await forkChat(chat.id);
      await refresh();
    } catch (err) {
      console.warn("[loom] forkChat failed", err);
    }
  };

  const onRename = (chat: ApiChat) => {
    setContextMenu(null);
    setRenameTargetId(chat.id);
  };

  const onSubmitRename = async (chatId: string, value: string | null) => {
    setRenameTargetId(null);
    try {
      await renameChat(chatId, value);
      await refresh();
    } catch (err) {
      console.warn("[loom] renameChat failed", err);
    }
  };

  const onCancelRename = () => {
    setRenameTargetId(null);
  };

  const onDelete = async (chatId: string) => {
    try {
      await deleteChat(chatId);
    } catch (err) {
      console.warn("[loom] deleteChat failed", err);
    }
    if (location === `/chat/${chatId}`) {
      navigate("/");
    }
    await refresh();
  };

  const onDeleteProject = async (project: ApiProject, deletedChatIds: string[]) => {
    try {
      await deleteProject(project.id);
    } catch (err) {
      console.warn("[loom] deleteProject failed", err);
    }
    if (deletedChatIds.some((id) => location === `/chat/${id}`)) {
      navigate("/");
    }
    await refresh();
  };

  const onSpawnChat = (project: ApiProject) => {
    setSpawnFor(project);
  };

  const onArchiveFabric = async (fabric: SidebarFabricEntry) => {
    try {
      await archiveFabric({
        id: fabric.id,
        projectId: fabric.projectId,
        fabricName: fabric.name,
        cwd: fabric.cwd,
      });
      await refresh();
    } catch (err) {
      console.warn("[loom] archiveFabric failed", err);
    }
  };

  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      {/* Strict 50/50 vertical split: top half = projects + chats,
          bottom half = fabrics. Each half scrolls independently. */}
      <div
        className="basis-1/2 grow-0 shrink-0 min-h-0 overflow-y-auto overflow-x-hidden px-1.5 py-2"
        data-testid="sidebar-chats-pane"
      >
        {/* Projects + chats section */}
        <div className="px-1.5 pt-1 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: "var(--muted-foreground)" }}>
            Projects
          </span>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="text-[10px] hover:text-[var(--foreground)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="New project"
            title="New project"
          >
            +
          </button>
        </div>

        {empty ? null : (
          <>
            {groups.map((g) => (
              <ProjectGroup
                key={g.project.id}
                project={g.project}
                chats={g.chats}
                location={location}
                onDelete={onDelete}
                onSpawnChat={onSpawnChat}
                onDeleteProject={onDeleteProject}
                onContextMenu={onContextMenu}
                detachedIds={detachedIds}
                renameTargetId={renameTargetId}
                onSubmitRename={onSubmitRename}
                onCancelRename={onCancelRename}
                isUnread={isUnread}
                onMarkRead={markRead}
              />
            ))}
            {unassigned.length > 0 ? (
              <div className="mt-3">
                <div className="px-2 py-1" style={{ color: "var(--muted-foreground)" }}>
                  <div className="text-[10px] uppercase tracking-wide">Unassigned</div>
                  <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                    Chats with no project
                  </div>
                </div>
                {unassigned.map((c) => (
                  <ChatLink
                    key={c.id}
                    chat={c}
                    active={location === `/chat/${c.id}`}
                    onDelete={onDelete}
                    onContextMenu={onContextMenu}
                    detached={detachedIds.has(c.id)}
                    isRenaming={renameTargetId === c.id}
                    onSubmitRename={(value) => onSubmitRename(c.id, value)}
                    onCancelRename={onCancelRename}
                    unread={isUnread(c.id)}
                    onMarkRead={() => markRead(c.id)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div
        className="basis-1/2 grow-0 shrink-0 min-h-0 overflow-y-auto overflow-x-hidden px-1.5 py-2 border-t"
        style={{ borderColor: "var(--border)" }}
        data-testid="sidebar-fabrics-pane"
      >
        {/* Fabrics section — auto-discovered .loom/<name>/ dirs across
            every project, rendered as a single flat list. */}
        <div className="px-1.5 pt-1 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: "var(--muted-foreground)" }}>
            Fabrics
          </span>
          <button
            onClick={() => setArchiveDialogOpen(true)}
            className="size-4 rounded grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Open fabric archive"
            title="Archived fabrics"
            data-testid="open-fabric-archive"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-3" aria-hidden>
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" />
              <path d="M10 12h4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {groups.some((g) => g.fabrics.length > 0) ? (
          <div>
            {groups
              .flatMap((g) => g.fabrics)
              .map((f) => (
                <FabricRow key={f.id} fabric={f} onArchive={onArchiveFabric} />
              ))}
          </div>
        ) : null}
      </div>

      {/* Settings has moved to the top app bar (top-right). The
          previous footer + divider were removed so the sidebar runs
          edge-to-edge. */}
      {newProjectOpen ? (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onUseExisting={(p) => setSpawnFor(p)}
        />
      ) : null}
      {spawnFor ? <SpawnChatModalLive onClose={() => setSpawnFor(null)} project={spawnFor} /> : null}
      {archiveDialogOpen ? (
        <FabricArchiveDialog
          onClose={() => setArchiveDialogOpen(false)}
          onAfterUnarchive={refresh}
        />
      ) : null}
      {contextMenu ? (
        <ChatContextMenu
          chat={contextMenu.chat}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onHandoff={onHandoff}
          onRename={onRename}
          onFork={onFork}
        />
      ) : null}
    </aside>
  );
}

function ProjectGroup({
  project,
  chats,
  location,
  onDelete,
  onSpawnChat,
  onDeleteProject,
  onContextMenu,
  detachedIds,
  renameTargetId,
  onSubmitRename,
  onCancelRename,
  isUnread,
  onMarkRead,
}: {
  project: ApiProject;
  chats: ApiChat[];
  location: string;
  onDelete: (id: string) => void | Promise<void>;
  onSpawnChat: (project: ApiProject) => void;
  onDeleteProject: (project: ApiProject, deletedChatIds: string[]) => void | Promise<void>;
  onContextMenu: (chat: ApiChat, evt: React.MouseEvent) => void;
  detachedIds: Set<string>;
  renameTargetId: string | null;
  onSubmitRename: (chatId: string, value: string | null) => void | Promise<void>;
  onCancelRename: () => void;
  isUnread: (chatId: string) => boolean;
  onMarkRead: (chatId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mb-1 min-w-0">
      <div className="group flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--accent)]">
        <span className="size-4 rounded-sm grid place-items-center text-[9px] font-bold bg-emerald-500/15 text-emerald-700 uppercase shrink-0">
          {project.name.slice(0, 1)}
        </span>
        <span className="text-xs font-medium flex-1 min-w-0 truncate text-[var(--foreground)]">{project.name}</span>
        {confirming ? (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {chats.length > 0 ? `Delete + ${chats.length} chat${chats.length === 1 ? "" : "s"}?` : "Delete?"}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setConfirming(false);
              }}
              className="text-[10px] px-1 rounded hover:bg-[var(--background)]"
              style={{ color: "var(--muted-foreground)" }}
              title="Cancel"
            >
              cancel
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setConfirming(false);
                void onDeleteProject(
                  project,
                  chats.map((c) => c.id),
                );
              }}
              className="text-[10px] px-1 rounded text-white"
              style={{ background: "var(--destructive)" }}
              title="Delete project"
              data-testid="confirm-delete-project"
            >
              delete
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onSpawnChat(project);
              }}
              className="opacity-0 group-hover:opacity-100 size-4 rounded grid place-items-center hover:bg-[var(--background)] shrink-0"
              style={{ color: "var(--muted-foreground)" }}
              aria-label={`New chat in ${project.name}`}
              title={`New chat in ${project.name}`}
              data-testid="new-chat-in-project"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setConfirming(true);
              }}
              className="opacity-0 group-hover:opacity-100 size-5 rounded grid place-items-center shrink-0"
              style={{ color: "var(--destructive)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--destructive)" }}
              aria-label={`Delete project ${project.name}`}
              title={`Delete project ${project.name}`}
              data-testid="delete-project"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="size-3">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <span className="text-[10px] shrink-0" style={{ color: "var(--muted-foreground)" }}>{chats.length}</span>
          </>
        )}
      </div>
      {chats.map((c) => (
        <ChatLink
          key={c.id}
          chat={c}
          active={location === `/chat/${c.id}`}
          onDelete={onDelete}
          onContextMenu={onContextMenu}
          detached={detachedIds.has(c.id)}
          isRenaming={renameTargetId === c.id}
          onSubmitRename={(value) => onSubmitRename(c.id, value)}
          onCancelRename={onCancelRename}
          unread={isUnread(c.id)}
          onMarkRead={() => onMarkRead(c.id)}
        />
      ))}
    </div>
  );
}

function FabricRow({
  fabric,
  onArchive,
}: {
  fabric: SidebarFabricEntry;
  onArchive: (fabric: SidebarFabricEntry) => void | Promise<void>;
}) {
  const [location, navigate] = useLocation();
  const href = `/fabric/${fabric.projectId}/${encodeURIComponent(fabric.name)}`;
  const active = location === href;
  const dotTitle = fabric.lifecycle === "complete"
    ? "done"
    : (fabric.phase ?? "no pipeline");
  return (
    <div
      className={clsx(
        "group flex items-center gap-1.5 px-2 py-1 min-w-0 rounded-md text-xs",
        active ? "bg-[var(--selected-row)]" : "hover:bg-[var(--accent)]",
      )}
      title={`${fabric.dotLoomPath} · ${dotTitle}`}
      data-testid="fabric-row"
      data-active={active ? "true" : undefined}
    >
      <button
        onClick={() => navigate(href)}
        className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
      >
        {/* Phase circle (red→green, gray when done) — mirrors the chat-row
            dot so fabric and chat entries share a shape. */}
        <span
          className={clsx(
            "size-1.5 rounded-full shrink-0",
            fabricDotClass(fabric.phase, fabric.lifecycle),
          )}
        />
        <span className="flex-1 min-w-0 truncate">{fabric.name}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void onArchive(fabric);
        }}
        className="opacity-0 group-hover:opacity-100 size-4 rounded grid place-items-center hover:bg-[var(--background)] shrink-0"
        style={{ color: "var(--muted-foreground)" }}
        aria-label={`Archive fabric ${fabric.name}`}
        title="Archive fabric"
        data-testid="archive-fabric"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-3" aria-hidden>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" />
          <path d="M10 12h4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Per-chat status glyph rendered after the chat name in the sidebar. Lets
 * the user tell at a glance whether a chat is actively working, waiting on
 * their input, or idle — without having to open it. Sourced from the
 * server-supplied `chat.live` snapshot (polled with the rest of the
 * sidebar state every ~5s).
 *
 *   • `needsInput`   → amber `!` (highest priority; a permission or
 *                       AskUserQuestion is outstanding).
 *   • `running`      → pulsing blue dot (matches the WorkingChip motif
 *                       inside the chat view).
 *   • `error`        → red dot.
 *   • idle / null    → no glyph (default).
 */
function LiveStatusGlyph({ live }: { live: ChatLiveState | null }) {
  if (!live) return null;
  if (live.needsInput) {
    return (
      <span
        className="text-[10px] font-bold shrink-0"
        style={{ color: "var(--warning, #d97706)" }}
        title="Waiting for your input"
        data-testid="chat-live-needs-input"
      >
        !
      </span>
    );
  }
  if (live.turnState === "running") {
    return (
      <span
        className="size-1.5 rounded-full shrink-0 animate-pulse"
        style={{ background: "var(--info, #2563eb)" }}
        title="Working"
        data-testid="chat-live-running"
      />
    );
  }
  if (live.turnState === "error") {
    return (
      <span
        className="size-1.5 rounded-full shrink-0"
        style={{ background: "var(--destructive, #dc2626)" }}
        title="Error"
        data-testid="chat-live-error"
      />
    );
  }
  return null;
}

function ChatLink({
  chat,
  active,
  onDelete,
  onContextMenu,
  detached,
  isRenaming,
  onSubmitRename,
  onCancelRename,
  unread,
  onMarkRead,
}: {
  chat: ApiChat;
  active: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onContextMenu: (chat: ApiChat, evt: React.MouseEvent) => void;
  detached: boolean;
  isRenaming: boolean;
  onSubmitRename: (value: string | null) => void | Promise<void>;
  onCancelRename: () => void;
  unread?: boolean;
  onMarkRead?: () => void;
}) {
  const cwdBasename = chat.cwd.split("/").filter(Boolean).slice(-1)[0] ?? chat.cwd;
  const label = chat.custom_name ?? chat.auto_title ?? cwdBasename;
  const dot = DOT_FOR_MODE[chat.permission_mode] ?? "bg-emerald-500";
  const [confirming, setConfirming] = useState(false);
  // Don't pulse the currently-open chat; the unread effect clears its
  // flag on the next tick, but the visual fights with the active-row
  // accent in the meantime. `needsInput` follows the same rule —
  // once you're looking at the chat, the permission prompt is right
  // there in the view, no need to pulse the sidebar row.
  const showNeedsInput = !!chat.live?.needsInput && !active;
  const showUnread = !!unread && !active && !showNeedsInput;
  return (
    <div
      className={clsx(
        "group flex items-center gap-1.5 px-2 py-1 ml-3 min-w-0 rounded-md text-xs",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
        showNeedsInput && "needs-input-pulse",
        showUnread && "unread-pulse",
      )}
      title={`${chat.cwd} · ${chat.permission_mode}${chat.inert ? " · inert" : ""}${showNeedsInput ? " · waiting for your input" : showUnread ? " · unread reply" : ""}`}
      onContextMenu={(evt) => onContextMenu(chat, evt)}
      data-unread={showUnread ? "true" : undefined}
      data-needs-input={showNeedsInput ? "true" : undefined}
    >
      {isRenaming ? (
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={clsx("size-1.5 rounded-full shrink-0", dot)} />
          <input
            autoFocus
            defaultValue={label}
            data-testid="chat-rename-input"
            className="flex-1 min-w-0 bg-transparent border rounded px-1 text-xs outline-none"
            style={{ borderColor: "var(--border)" }}
            onKeyDown={(evt) => {
              if (evt.key === "Enter") {
                evt.preventDefault();
                const trimmed = evt.currentTarget.value.trim();
                onSubmitRename(trimmed.length === 0 ? null : trimmed);
              } else if (evt.key === "Escape") {
                evt.preventDefault();
                onCancelRename();
              }
            }}
            onBlur={() => onCancelRename()}
          />
        </div>
      ) : (
      <Link
        href={`/chat/${chat.id}`}
        className="flex-1 min-w-0 overflow-hidden"
        onClick={() => onMarkRead?.()}
      >
        <div className="flex items-center gap-1.5 cursor-pointer min-w-0">
          {detached ? (
            <span className="text-[10px] text-[var(--muted-foreground)] font-mono shrink-0" title="detached">↗</span>
          ) : (
            <span className={clsx("size-1.5 rounded-full shrink-0", dot)} />
          )}
          <span className="flex-1 min-w-0 truncate">{label}</span>
          <LiveStatusGlyph live={chat.live ?? null} />
          {chat.inert ? <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">·z</span> : null}
          {chat.worktree_mode === "worktree" ? <span className="text-[10px] text-[var(--muted-foreground)] font-mono shrink-0">⎇</span> : null}
        </div>
      </Link>
      )}
      {confirming ? (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setConfirming(false);
            }}
            className="text-[10px] px-1 rounded hover:bg-[var(--background)]"
            style={{ color: "var(--muted-foreground)" }}
            title="Cancel"
          >
            cancel
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setConfirming(false);
              void onDelete(chat.id);
            }}
            className="text-[10px] px-1 rounded text-white"
            style={{ background: "var(--destructive)" }}
            title="Delete"
          >
            delete
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setConfirming(true);
          }}
          className="opacity-0 group-hover:opacity-100 size-4 rounded grid place-items-center hover:bg-[var(--background)] shrink-0"
          style={{ color: "var(--muted-foreground)" }}
          aria-label="Delete chat"
          title="Delete chat"
          data-testid="delete-chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
