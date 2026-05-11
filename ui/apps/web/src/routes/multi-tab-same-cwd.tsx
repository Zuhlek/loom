import { AppSidebarLayout } from "../components/layout/AppSidebarLayout";
import { ChatHeader } from "../components/chat/ChatHeader";
import { ChatMessage } from "../components/chat/ChatMessages";
import { ChatComposer } from "../components/chat/ChatComposer";
import type { ProjectGroup } from "../components/Sidebar";

const PROJECTS: ProjectGroup[] = [
  {
    id: "loom",
    label: "loom",
    initial: "N",
    accent: "emerald",
    count: 3,
    chats: [
      { id: "c1", label: "Refine sidebar layout", active: true, permissionDot: "default", subtitle: "PID 47821" },
      { id: "c2", label: "Test infrastructure scan", permissionDot: "accept-edits", subtitle: "PID 47914" },
      { id: "c3", label: "PGlite migration", permissionDot: "bypass", worktree: true },
    ],
  },
];

/** Mockup 12: two chats sharing the same cwd, no warning. */
export function MultiTabSameCwd() {
  return (
    <AppSidebarLayout sidebar={{ chatGroups: PROJECTS, emptyLooms: true }}>
      <ChatHeader title="Refine sidebar layout" permissionMode="default" cwd="~/dev/repo/loom · PID 47821" mode="local" />
      <div className="mx-5 mt-3 rounded-lg border p-3 flex items-start gap-2.5" style={{ borderColor: "rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.04)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 mt-0.5 shrink-0" style={{ color: "var(--info)" }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <div className="flex-1">
          <p className="text-xs font-medium" style={{ color: "var(--info-foreground)" }}>
            Another chat is running in this cwd.
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            "Test infrastructure scan" (PID 47914) shares <code className="font-mono px-1 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>~/dev/repo/loom</code>. Each chat owns its own PID/PTY. Conflict responsibility stays with you. <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>SR-36</span>
          </p>
        </div>
        <button className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <ChatMessage role="user">
            <div className="text-sm">Walking through Sidebar.logic.ts to add the Looms sub-section.</div>
          </ChatMessage>
          <ChatMessage role="assistant" subtitle="Default permission">
            <div className="text-sm">
              Found <code className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>buildSidebarProjectSnapshots</code>. Adding a parallel <code className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>collectLoomRowsForProject</code> that scans <code className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>project.paths × .loom/&lt;project&gt;/</code>.
            </div>
          </ChatMessage>
        </div>
      </div>
      <ChatComposer />
    </AppSidebarLayout>
  );
}
