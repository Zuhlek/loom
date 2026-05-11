import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AppSidebarLayout } from "../components/layout/AppSidebarLayout";
import { SpawnChatModalLive } from "./spawn-chat-dialog-live";

type PermissionMode = "default" | "plan" | "accept-edits" | "trusted-vm";

const MODES: Array<{ id: PermissionMode; label: string; subtitle: string; dot: string }> = [
  { id: "default", label: "Default", subtitle: "Ask before risky tools", dot: "var(--success)" },
  { id: "plan", label: "Plan", subtitle: "Read-only mode", dot: "var(--info)" },
  { id: "accept-edits", label: "Accept-edits", subtitle: "Auto-approve edits", dot: "var(--warning)" },
  { id: "trusted-vm", label: "Trusted-VM", subtitle: "Skip all prompts", dot: "var(--destructive)" },
];

const PROJECTS = ["nora", "cinnamon", "visana", "— Create new..."];

/** /spawn — opens the live spawn modal on top of the live home. */
export function SpawnChatDialogPage() {
  const [, navigate] = useLocation();
  return (
    <div className="relative h-screen">
      <AppSidebarLayout sidebar={{ emptyChats: true, emptyLooms: true }}>
        <header className="border-b px-5 py-3 opacity-30" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No active chat
          </span>
        </header>
      </AppSidebarLayout>
      <SpawnChatModalLive onClose={() => navigate("/")} />
    </div>
  );
}

export function SpawnChatModal({ onClose }: { onClose?: () => void } = {}) {
  const [cwd, setCwd] = useState("/Users/tristan/dev/repo/nora");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [worktree, setWorktree] = useState(false);
  const [project, setProject] = useState("nora");

  return (
    <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
      <div className="px-5 py-4 border-b flex items-center gap-2.5" style={{ borderColor: "var(--border)" }}>
        <div className="size-8 rounded-lg grid place-items-center" style={{ background: "var(--muted)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Spawn new chat</h2>
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Each chat is one Claude Code PID via PTY.
          </p>
        </div>
        <Link href="/empty">
          <button
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </Link>
      </div>

      <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="text-xs font-medium">Working directory</label>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md border" style={{ borderColor: "var(--border)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }}>
                <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm font-mono"
              />
              <span className="text-[10px] px-1.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "var(--success-foreground)" }}>
                git
              </span>
            </div>
            <button className="px-2.5 py-1.5 rounded-md text-xs font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
              Browse
            </button>
          </div>
          <div className="mt-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Recent
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {["~/dev/repo/nora", "~/dev/repo/cinnamon", "~/dev/repo/visana"].map((p) => (
              <button
                key={p}
                onClick={() => setCwd(p)}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono hover:bg-[var(--accent)] border"
                style={{ borderColor: "var(--border)" }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium">Permission mode</label>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            {MODES.map((m) => {
              const sel = mode === m.id;
              return (
                <label
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer"
                  style={
                    sel
                      ? { borderWidth: 2, borderStyle: "solid", borderColor: "var(--primary)", background: "rgba(59,130,246,0.04)" }
                      : { borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }
                  }
                >
                  <div className="size-3.5 rounded-full grid place-items-center" style={{ borderWidth: 2, borderStyle: "solid", borderColor: sel ? "var(--primary)" : "var(--border)" }}>
                    {sel && <div className="size-1.5 rounded-full" style={{ background: "var(--primary)" }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full" style={{ background: m.dot }} />
                      <span className="text-xs font-medium">{m.label}</span>
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      {m.subtitle}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-md border cursor-pointer" style={{ borderColor: "var(--border)" }}>
            <input
              type="checkbox"
              checked={worktree}
              onChange={(e) => setWorktree(e.target.checked)}
              className="size-3.5 mt-0.5 accent-[var(--primary)]"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">Worktree mode</span>
                <span className="text-[9px] uppercase tracking-wide font-medium px-1 rounded font-mono" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                  opt-in
                </span>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Run claude in <code className="font-mono">&lt;worktrees-root&gt;/&lt;repo&gt;/&lt;branch&gt;</code> off the current branch. Required for the diff split-pane.
              </p>
              <div className="mt-1.5 flex items-start gap-1.5 px-2 py-1 rounded text-[10px]" style={{ background: "rgba(245,158,11,0.08)", color: "var(--warning-foreground)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3 mt-0.5 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>Spawn rejected if cwd is not a git repo. Local mode allows any cwd.</span>
              </div>
            </div>
          </label>
        </div>

        <div>
          <label className="text-xs font-medium">Assign to Project</label>
          <div className="flex items-center gap-2 mt-1.5">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none"
              style={{ borderColor: "var(--border)" }}
            >
              {PROJECTS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button className="px-2.5 py-1.5 rounded-md text-xs font-medium border hover:bg-[var(--accent)] inline-flex items-center gap-1" style={{ borderColor: "var(--border)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New
            </button>
          </div>
          <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
            A Project is a user-named bucket. One Project may span multiple paths.
          </p>
          <button className="text-[11px] mt-1.5 underline-offset-2 hover:underline" style={{ color: "var(--info)" }}>
            + Import existing folder...
          </button>
        </div>
      </div>

      <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
        <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
          claude --cwd {cwd} --permission-mode {mode}
        </span>
        <div className="flex items-center gap-2">
          <Link href="/empty">
            <button className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
              Cancel
            </button>
          </Link>
          <Link href={worktree ? "/chat/worktree" : "/chat/local"}>
            <button className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm" style={{ background: "var(--primary)" }}>
              Spawn chat
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
