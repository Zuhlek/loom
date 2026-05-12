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
import { SpawnChatModalLive } from "../routes/spawn-chat-dialog-live";
import { NewProjectDialog } from "./NewProjectDialog";
import { ChatContextMenu } from "./sidebar/ChatContextMenu";
import {
  deleteChat,
  deleteProject,
  forkChat,
  handoffChat,
  type ApiChat,
  type ApiProject,
  type SidebarLoomEntry,
} from "../lib/api";
import clsx from "clsx";

interface ContextMenuState {
  chat: ApiChat;
  x: number;
  y: number;
}

const DOT_FOR_MODE: Record<ApiChat["permission_mode"], string> = {
  default: "bg-emerald-500",
  plan: "bg-blue-500",
  "accept-edits": "bg-amber-500",
  "trusted-vm": "bg-red-500",
};

export function LiveSidebar() {
  const { state, error, refresh } = useSidebarState();
  const [location, navigate] = useLocation();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [spawnFor, setSpawnFor] = useState<ApiProject | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set());

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

  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 py-2">
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
            + New project
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
                  />
                ))}
              </div>
            ) : null}
          </>
        )}

        {/* Looms section — auto-discovered .loom/<name>/ dirs in each
            project's paths, grouped per project. */}
        <div className="px-1.5 pt-4 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: "var(--muted-foreground)" }}>
            Looms
          </span>
          <button
            onClick={() => {
              void refresh();
            }}
            className="text-[10px] hover:text-[var(--foreground)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Refresh looms"
            title="Refresh looms"
            data-testid="refresh-looms"
          >
            Refresh
          </button>
        </div>
        {groups.some((g) => g.looms.length > 0) ? (
          <div>
            {groups
              .filter((g) => g.looms.length > 0)
              .map((g) => (
                <LoomProjectGroup key={g.project.id} project={g.project} looms={g.looms} />
              ))}
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="border-t px-2.5 py-2 flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <Link href="/settings">
          <button
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 014 17.93l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9.9a1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 016.07 4l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 009.1 2.91V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06A2 2 0 0119.93 7l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.27.66.92 1.09 1.65 1.09H21a2 2 0 010 4h-.09c-.73 0-1.38.43-1.65 1.09z" />
            </svg>
          </button>
        </Link>
      </div>
      {newProjectOpen ? (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onUseExisting={(p) => setSpawnFor(p)}
        />
      ) : null}
      {spawnFor ? <SpawnChatModalLive onClose={() => setSpawnFor(null)} project={spawnFor} /> : null}
      {contextMenu ? (
        <ChatContextMenu
          chat={contextMenu.chat}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onHandoff={onHandoff}
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
}: {
  project: ApiProject;
  chats: ApiChat[];
  location: string;
  onDelete: (id: string) => void | Promise<void>;
  onSpawnChat: (project: ApiProject) => void;
  onDeleteProject: (project: ApiProject, deletedChatIds: string[]) => void | Promise<void>;
  onContextMenu: (chat: ApiChat, evt: React.MouseEvent) => void;
  detachedIds: Set<string>;
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
        />
      ))}
    </div>
  );
}

function LoomProjectGroup({
  project,
  looms,
}: {
  project: ApiProject;
  looms: SidebarLoomEntry[];
}) {
  const [, navigate] = useLocation();
  return (
    <div className="mb-1 min-w-0">
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md">
        <span className="size-4 rounded-sm grid place-items-center text-[9px] font-bold bg-emerald-500/15 text-emerald-700 uppercase shrink-0">
          {project.name.slice(0, 1)}
        </span>
        <span className="text-xs font-medium flex-1 min-w-0 truncate text-[var(--foreground)]">{project.name}</span>
        <span className="text-[10px] shrink-0" style={{ color: "var(--muted-foreground)" }}>{looms.length}</span>
      </div>
      {looms.map((f) => (
        <button
          key={f.id}
          onClick={() => navigate(`/loom/${f.projectId}/${encodeURIComponent(f.name)}`)}
          className="w-full flex items-center gap-1.5 px-2 py-1 ml-3 min-w-0 rounded-md text-xs hover:bg-[var(--accent)]"
          title={`${f.dotLoomPath}`}
          data-testid="loom-row"
        >
          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            {/* Rune-ish glyph for loom entries; matches the static demo header. */}
            ᚠ
          </span>
          <span className="flex-1 min-w-0 truncate text-left">{f.name}</span>
          <span className="text-[9px] font-mono px-1 rounded shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
            …
          </span>
        </button>
      ))}
    </div>
  );
}

function ChatLink({
  chat,
  active,
  onDelete,
  onContextMenu,
  detached,
}: {
  chat: ApiChat;
  active: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onContextMenu: (chat: ApiChat, evt: React.MouseEvent) => void;
  detached: boolean;
}) {
  const label = chat.cwd.split("/").filter(Boolean).slice(-1)[0] ?? chat.cwd;
  const dot = DOT_FOR_MODE[chat.permission_mode] ?? "bg-emerald-500";
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={clsx(
        "group flex items-center gap-1.5 px-2 py-1 ml-3 min-w-0 rounded-md text-xs",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
      title={`${chat.cwd} · ${chat.permission_mode}${chat.inert ? " · inert" : ""}`}
      onContextMenu={(evt) => onContextMenu(chat, evt)}
    >
      <Link href={`/chat/${chat.id}`} className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 cursor-pointer min-w-0">
          {detached ? (
            <span className="text-[10px] text-[var(--muted-foreground)] font-mono shrink-0" title="detached">↗</span>
          ) : (
            <span className={clsx("size-1.5 rounded-full shrink-0", dot)} />
          )}
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {chat.inert ? <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">·z</span> : null}
          {chat.worktree_mode === "worktree" ? <span className="text-[10px] text-[var(--muted-foreground)] font-mono shrink-0">⎇</span> : null}
        </div>
      </Link>
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
