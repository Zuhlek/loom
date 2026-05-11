import { Link } from "wouter";
import { AppSidebarLayout } from "../components/layout/AppSidebarLayout";

/** Mockup 02: empty home with two-section sidebar (Chats + Looms). */
export function EmptyHome() {
  return (
    <AppSidebarLayout sidebar={{ emptyChats: true, emptyLooms: true }}>
      <header className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
        <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
          No active chat
        </span>
      </header>

      <div className="flex-1 grid place-items-center px-6">
        <div
          className="w-full max-w-lg rounded-3xl border px-8 py-12 text-center"
          style={{ borderColor: "rgba(0,0,0,0.06)", background: "rgba(255,255,255,0.6)" }}
        >
          <div className="size-12 mx-auto rounded-2xl grid place-items-center mb-4" style={{ background: "rgba(0,0,0,0.04)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-6" style={{ color: "var(--muted-foreground)" }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <h1 className="text-xl tracking-tight" style={{ color: "var(--foreground)" }}>
            Spawn your first chat
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>
            Pick a working directory, a permission preset, and optionally opt in to worktree mode. Each chat owns its own Claude Code PID.
          </p>
          <Link href="/spawn">
            <button className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-white shadow-sm" style={{ background: "var(--primary)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Spawn chat
            </button>
          </Link>
          <div className="mt-6 pt-5 border-t flex items-center justify-center gap-4 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: "var(--success)" }} />
              hooks installed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: "var(--success)" }} />
              claude /login OK
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono">~/dev/repo</span>
            </span>
          </div>
        </div>
      </div>
    </AppSidebarLayout>
  );
}
