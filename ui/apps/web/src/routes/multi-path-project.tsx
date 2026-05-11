import { AppSidebarLayout } from "../components/layout/AppSidebarLayout";
import type { ProjectGroup } from "../components/Sidebar";

const LOOM_PROJECT: ProjectGroup = {
  id: "loom",
  label: "loom",
  initial: "N",
  accent: "emerald",
  count: 5,
};

const PATH_GROUPS: Array<{ path: string; chats: ProjectGroup["chats"] }> = [
  {
    path: "~/dev/repo/loom",
    chats: [
      { id: "c1", label: "Refine sidebar layout", active: true, permissionDot: "default" },
      { id: "c2", label: "Test infrastructure scan", permissionDot: "accept-edits" },
    ],
  },
  {
    path: "~/dev/repo/loom-server",
    chats: [{ id: "c3", label: "PGlite migration", permissionDot: "bypass", worktree: true }],
  },
  {
    path: "~/dev/repo/loom-web",
    chats: [
      { id: "c4", label: "Diff panel lift", permissionDot: "default" },
      { id: "c5", label: "Composer @-file", permissionDot: "default", awaitingInput: true },
    ],
  },
];

const PROJECT_LOOMS: ProjectGroup["looms"] = [
  { id: "f1", label: ".loom/", phase: "P3", subtitle: "~/dev/repo/loom", done: true },
  { id: "f2", label: ".loom/loom-server/", phase: "P2", subtitle: "~/dev/repo/loom-server" },
];

/** Mockup 13: one Project (loom) assigned to 3 paths. */
export function MultiPathProject() {
  return (
    <AppSidebarLayout
      sidebar={{
        chatGroups: [
          {
            ...LOOM_PROJECT,
            chats: PATH_GROUPS.flatMap((g) => g.chats ?? []),
          },
        ],
        loomGroups: [{ ...LOOM_PROJECT, looms: PROJECT_LOOMS }],
      }}
    >
      <header className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
          Project: loom — assigned to 3 paths
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl mx-auto space-y-3">
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            One Project may span multiple paths. Chats and looms are grouped per-path so the developer can disambiguate at a glance. The sidebar's per-path subtitle (e.g. <code className="font-mono">~/dev/repo/loom-server</code>) appears below the Project header.
          </p>
          <ul className="space-y-2 mt-4">
            {PATH_GROUPS.map((g) => (
              <li key={g.path} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs">{g.path}</code>
                  <span className="text-[10px] px-1.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                    {g.chats?.length ?? 0} chats
                  </span>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {g.chats?.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full" style={{ background: c.permissionDot === "accept-edits" ? "var(--info)" : c.permissionDot === "bypass" ? "var(--warning)" : "var(--success)" }} />
                      <span>{c.label}</span>
                      {c.worktree && <span className="font-mono text-[10px] text-[var(--muted-foreground)]">⎇</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppSidebarLayout>
  );
}
