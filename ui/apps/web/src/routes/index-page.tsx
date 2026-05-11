import { Link } from "wouter";

const sections: Array<{
  title: string;
  pages: Array<{ path: string; label: string; subtitle: string; tag?: string }>;
}> = [
  {
    title: "First-run & empty state",
    pages: [
      { path: "/discover", label: "Discover wizard", subtitle: "First-run scan that proposes a workspace root.", tag: "01" },
      { path: "/empty", label: "Empty home", subtitle: "Two-section sidebar (Chats + Looms) with empty hints.", tag: "02" },
      { path: "/spawn", label: "Spawn chat dialog", subtitle: "cwd picker, permission radio, worktree opt-in, Project assigner.", tag: "03" },
    ],
  },
  {
    title: "Chat surface",
    pages: [
      { path: "/chat/local", label: "Chat — local mode", subtitle: "Assistant + user turns, subagent card, slash divider.", tag: "04" },
      { path: "/chat/worktree", label: "Chat — worktree mode + diff", subtitle: "DiffPanel split-pane, branch toolbar.", tag: "05" },
      { path: "/chat/askuserquestion", label: "Pending — AskUserQuestion picker", subtitle: "Multi-choice picker with free-form fallback.", tag: "10" },
      { path: "/chat/permission", label: "Pending — PermissionRequest", subtitle: "Inline allow/deny card.", tag: "11" },
    ],
  },
  {
    title: "Loom artifact view",
    pages: [
      { path: "/loom/idea", label: "Loom — idea phase pending", subtitle: "Read-only loom view with phase stepper at idea.", tag: "06" },
      { path: "/loom/plan", label: "Loom — plan complete", subtitle: "plan.md rendered as markdown.", tag: "07" },
      { path: "/loom/mockup", label: "Loom — mockup rendering", subtitle: "Sandboxed iframe preview.", tag: "08" },
      { path: "/loom/build", label: "Loom — build phase kanban", subtitle: "board.md kanban + events.jsonl tail.", tag: "09" },
    ],
  },
  {
    title: "Sidebar variants",
    pages: [
      { path: "/multi-tab", label: "Multi-tab same cwd", subtitle: "Two chats sharing a cwd.", tag: "12" },
      { path: "/multi-path", label: "Multi-path Project", subtitle: "One Project assigned to 3 paths.", tag: "13" },
      { path: "/handoff", label: "Handoff / Fork context menu", subtitle: "Per-chat right-click menu.", tag: "14" },
    ],
  },
  {
    title: "Settings",
    pages: [
      { path: "/settings", label: "Settings — Hooks panel", subtitle: "Workspace / Hooks / Worktrees / Auth.", tag: "15" },
      { path: "/settings/conflict", label: "Hook conflict banner", subtitle: "Append-below-marker policy with Show diff.", tag: "16" },
    ],
  },
];

export function Index() {
  return (
    <div className="overflow-y-auto h-screen">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="flex items-center gap-3 mb-3">
          <div className="size-10 rounded-xl grid place-items-center text-white text-lg font-semibold" style={{ background: "var(--primary)" }}>
            N
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Nora — Mockup pages</h1>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Phase 4 build · React + Vite + Tailwind v3 (CDN)
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.18)", color: "var(--success-foreground)" }}>
              16 pages
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              v0.1
            </span>
          </div>
        </header>

        <div className="rounded-lg border p-3 mb-6 text-xs flex items-start gap-2" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <p style={{ color: "var(--muted-foreground)" }}>
            React port of the Phase 2.5 visual mockups. Tailwind via CDN, wouter for routing. No live data; placeholder state only.
          </p>
        </div>

        {sections.map((section) => (
          <section key={section.title} className="mb-6">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-medium mb-2" style={{ color: "var(--muted-foreground)" }}>
              {section.title}
            </h2>
            <ul className="rounded-xl border overflow-hidden divide-y" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              {section.pages.map((page) => (
                <li key={page.path}>
                  <Link href={page.path}>
                    <a className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--accent)] transition-colors cursor-pointer">
                      <span className="text-[10px] font-mono mt-0.5 px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                        {page.tag ?? "—"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{page.label}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                          {page.subtitle}
                        </p>
                      </div>
                    </a>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <footer className="mt-8 pt-6 border-t text-[11px] flex items-center justify-between" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
          <span>apps/web · Phase 4 build</span>
          <span className="font-mono">React + Vite · 16 pages</span>
        </footer>
      </div>
    </div>
  );
}
