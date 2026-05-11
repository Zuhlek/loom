import { useState } from "react";
import { AppSidebarLayout } from "../components/layout/AppSidebarLayout";
import { ChatHeader } from "../components/chat/ChatHeader";
import type { ProjectGroup } from "../components/Sidebar";

const PROJECTS: ProjectGroup[] = [
  {
    id: "nora",
    label: "nora",
    initial: "N",
    accent: "emerald",
    count: 2,
    chats: [
      { id: "c1", label: "Refine sidebar layout", active: true, permissionDot: "default" },
      { id: "c2", label: "PGlite migration", permissionDot: "accept-edits", worktree: true },
    ],
  },
];

/** Mockup 14: per-chat right-click menu with Handoff and Fork. */
export function HandoffForkMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; chatId: string } | null>({
    x: 220,
    y: 200,
    chatId: "c1",
  });

  return (
    <div
      onClick={() => setMenu(null)}
      className="relative h-screen"
    >
      <AppSidebarLayout
        sidebar={{
          chatGroups: PROJECTS,
          emptyLooms: true,
          onContextMenu: (chatId, evt) => {
            evt.preventDefault();
            setMenu({ x: evt.clientX, y: evt.clientY, chatId });
          },
        }}
      >
        <ChatHeader title="Refine sidebar layout" permissionMode="default" cwd="~/dev/repo/nora" mode="local" />
        <div className="flex-1 grid place-items-center px-5">
          <p className="text-sm text-center max-w-md" style={{ color: "var(--muted-foreground)" }}>
            Right-click any chat row in the sidebar to open the per-chat context menu. The menu is also reachable from the header dot-dot-dot button.
          </p>
        </div>
      </AppSidebarLayout>

      {menu && (
        <div
          className="absolute rounded-lg border bg-white shadow-lg overflow-hidden text-xs w-56"
          style={{ left: menu.x, top: menu.y, borderColor: "var(--border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
            <p className="font-medium">Refine sidebar layout</p>
            <p className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              PID 47821 · ~/dev/repo/nora
            </p>
          </div>
          <button className="w-full text-left px-3 py-2 hover:bg-[var(--accent)] flex items-start gap-2.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5 mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              <path d="M4 6h16v12H4zM7 9l3 3-3 3M13 15h4" />
            </svg>
            <div className="flex-1">
              <div className="text-xs font-medium">Handoff to terminal</div>
              <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                Detach this PTY into a system terminal; chat row goes detached state.
              </div>
            </div>
          </button>
          <button className="w-full text-left px-3 py-2 hover:bg-[var(--accent)] flex items-start gap-2.5 border-t" style={{ borderColor: "var(--border)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5 mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              <circle cx="6" cy="6" r="2" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="12" cy="20" r="2" />
              <path d="M6 8v4a2 2 0 002 2h4M18 8v4a2 2 0 01-2 2h-4M12 14v4" />
            </svg>
            <div className="flex-1">
              <div className="text-xs font-medium">Fork in terminal</div>
              <div className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                Open a new system terminal with the same cwd & permission preset; chat unchanged.
              </div>
            </div>
          </button>
          <div className="border-t px-3 py-1.5 text-[10px] font-mono" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            SR-40
          </div>
        </div>
      )}
    </div>
  );
}
