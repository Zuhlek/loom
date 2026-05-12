/**
 * LiveHome — the real "/" route. Uses /api/sidebar/state to populate the
 * sidebar; renders the project-first empty CTA when there are no projects
 * yet, a project-picker when projects exist but no chats yet, and a
 * "select a chat" hint when chats exist.
 */
import { useState } from "react";
import { AppLayout } from "../components/layout/AppLayout";
import { LiveSidebar } from "../components/LiveSidebar";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { SpawnChatModalLive } from "./spawn-chat-dialog-live";
import { useSidebarState } from "../lib/sidebar-state";
import type { ApiProject } from "../lib/api";

export function LiveHome() {
  const { state, error } = useSidebarState();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [spawnFor, setSpawnFor] = useState<ApiProject | null>(null);

  const hasProjects = !!state && state.groups.length > 0;
  const hasChats =
    !!state &&
    (state.unassigned.length > 0 || state.groups.some((g) => g.chats.length > 0));

  const topBar = error ? (
    <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--destructive)" }}>
      backend: {error}
    </span>
  ) : undefined;

  return (
    <AppLayout topBar={topBar} leftDrawer={<LiveSidebar />}>
        <div className="flex-1 grid place-items-center px-6 overflow-y-auto">
          {!hasProjects ? (
            <div
              className="w-full max-w-lg rounded-3xl border px-8 py-12 text-center"
              style={{ borderColor: "rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.6)" }}
            >
              <div className="size-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: "rgba(0,0,0,0.04)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-6" style={{ color: "var(--muted-foreground)" }}>
                  <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <h1 className="text-xl tracking-tight" style={{ color: "var(--foreground)" }}>
                Create your first project
              </h1>
              <button
                onClick={() => setNewProjectOpen(true)}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-white shadow-sm"
                style={{ background: "var(--primary)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New project
              </button>
            </div>
          ) : !hasChats ? (
            <div
              className="w-full max-w-lg rounded-3xl border px-8 py-10"
              style={{ borderColor: "rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.6)" }}
            >
              <h1 className="text-lg tracking-tight text-center" style={{ color: "var(--foreground)" }}>
                Open a chat in a project
              </h1>
              <div className="mt-5 space-y-1.5">
                {state!.groups.map((g) => (
                  <button
                    key={g.project.id}
                    onClick={() => setSpawnFor(g.project)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md border hover:bg-[var(--accent)] text-left"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className="size-4 rounded-sm grid place-items-center text-[9px] font-bold bg-emerald-500/15 text-emerald-700 uppercase">
                      {g.project.name.slice(0, 1)}
                    </span>
                    <span className="flex-1 text-xs font-medium truncate">{g.project.name}</span>
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      + chat
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-5 text-center">
                <button
                  onClick={() => setNewProjectOpen(true)}
                  className="text-[11px] underline-offset-2 hover:underline"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Or create another project
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => setNewProjectOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm"
                style={{ background: "var(--primary)" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New project
              </button>
            </div>
          )}
        </div>

      {newProjectOpen ? (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onUseExisting={(p) => setSpawnFor(p)}
        />
      ) : null}
      {spawnFor ? <SpawnChatModalLive onClose={() => setSpawnFor(null)} project={spawnFor} /> : null}
    </AppLayout>
  );
}
