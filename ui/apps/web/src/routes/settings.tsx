import { Link } from "wouter";
import clsx from "clsx";

interface SettingsProps {
  /** "default" | "conflict" */
  variant: string;
}

const NAV: Array<{ id: string; label: string; tag?: { label: string; tone: "ok" | "info" } }> = [
  { id: "workspace", label: "Workspace" },
  { id: "hooks", label: "Hooks", tag: { label: "ok", tone: "ok" } },
  { id: "worktrees", label: "Worktrees" },
  { id: "auth", label: "Auth", tag: { label: "claude", tone: "ok" } },
  { id: "about", label: "About" },
];

const WIRED_EVENTS = ["PostToolUse", "SessionStart", "Stop", "SubagentStop", "PermissionRequest"];

/** Mockups 15 (default) and 16 (conflict). */
export function Settings({ variant }: SettingsProps) {
  const isConflict = variant === "conflict";
  return (
    <div className="h-screen flex">
      <aside className="w-60 shrink-0 flex flex-col border-r" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="px-3 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <Link href="/empty">
            <button className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }} aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </Link>
          <span className="text-sm font-medium">Settings</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="space-y-0.5">
            {NAV.map((n) => {
              const active = n.id === "hooks";
              return (
                <button
                  key={n.id}
                  className={clsx(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left",
                    active ? "font-medium" : "hover:bg-[var(--accent)]",
                  )}
                  style={active ? { background: "var(--accent)" } : { color: "var(--muted-foreground)" }}
                >
                  <span className="size-3.5" />
                  {n.label}
                  {n.tag && (
                    <span
                      className="ml-auto text-[9px] font-mono px-1 rounded"
                      style={{ background: "rgba(16,185,129,0.18)", color: "var(--success-foreground)" }}
                    >
                      {n.tag.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t px-3 py-2 text-[10px] font-mono" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
          nora v0.1 · localhost:7891
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="border-b px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-base font-semibold tracking-tight">Hooks</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Auto-installed at user scope (<code className="font-mono">~/.claude/settings.json</code>) with marker for clean uninstall.
          </p>
        </header>

        <div className="flex-1 px-6 py-5 max-w-3xl space-y-5">
          {isConflict ? <ConflictBanner /> : <InstalledStatus />}
          <WiredEvents dim={isConflict} />
          {!isConflict && <MarkerBlock />}
          {!isConflict && <Diagnostics />}
        </div>
      </main>
    </div>
  );
}

function InstalledStatus() {
  return (
    <div className="rounded-xl border p-4 flex items-start gap-3" style={{ borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.04)" }}>
      <div className="size-8 rounded-full grid place-items-center" style={{ background: "rgba(16,185,129,0.18)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="size-4" style={{ color: "var(--success-foreground)" }}>
          <path d="M5 12l5 5L20 7" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Hooks installed and healthy.</p>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.18)", color: "var(--success-foreground)" }}>
            marker: nora:hooks
          </span>
        </div>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Installed 2026-05-08 14:21 · 5 events wired · receiver port 7891 verified
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
          Reinstall
        </button>
        <button className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border" style={{ borderColor: "rgba(239,68,68,0.4)", color: "var(--destructive-foreground)" }}>
          Uninstall
        </button>
      </div>
    </div>
  );
}

function WiredEvents({ dim }: { dim?: boolean }) {
  return (
    <div className={dim ? "opacity-50" : ""}>
      <h2 className="text-xs font-medium mb-2">
        Wired events {dim && <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>(after install)</span>}
      </h2>
      <div className="grid grid-cols-2 gap-1.5">
        {WIRED_EVENTS.map((e) => (
          <div key={e} className="px-3 py-2 rounded-md border flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
            <span className="size-1.5 rounded-full" style={{ background: dim ? "var(--muted-foreground)" : "var(--success)" }} />
            <code className="font-mono text-[11px]">{e}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkerBlock() {
  return (
    <div>
      <h2 className="text-xs font-medium mb-2 flex items-center gap-2">
        Installed marker block <span className="text-[10px] font-mono px-1 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>SR-39</span>
      </h2>
      <p className="text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>
        nora appends its hooks below your existing hooks wrapped in this marker. Uninstall removes only this block.
      </p>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <div className="px-3 py-1.5 border-b flex items-center justify-between text-[10px] font-mono" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.012)" }}>
          <span>~/.claude/settings.json</span>
          <span style={{ color: "var(--muted-foreground)" }}>read-only</span>
        </div>
        <pre className="text-[11px] font-mono p-3 overflow-x-auto leading-relaxed" style={{ background: "rgba(0,0,0,0.012)" }}>
          <code>
            <span style={{ color: "var(--muted-foreground)" }}>{`{
  "hooks": {
    "PostToolUse": [
      // your existing hooks (untouched)
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "..." }] },
`}</span>
            <span style={{ color: "var(--info-foreground)", fontWeight: 600 }}>      // nora:hooks:start</span>
            <span style={{ color: "var(--success-foreground)" }}>      ← block start{"\n"}</span>
            <span style={{ background: "rgba(16,185,129,0.06)", display: "block", padding: "0 0.4rem", borderLeft: "2px solid var(--success)" }}>
              {`      { "type": "command", "command": "curl -s http://127.0.0.1:7891/hooks" },`}
            </span>
            <span style={{ color: "var(--info-foreground)", fontWeight: 600 }}>      // nora:hooks:end</span>
            <span style={{ color: "var(--success-foreground)" }}>      ← block end</span>
            <span style={{ color: "var(--muted-foreground)" }}>{`
    ],
    ...
  }
}`}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

function Diagnostics() {
  return (
    <div>
      <h2 className="text-xs font-medium mb-2">Diagnostics</h2>
      <div className="rounded-lg border divide-y" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span>Last hook delivered</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            PostToolUse · 2s ago
          </span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span>Receiver socket</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--success-foreground)" }}>
            127.0.0.1:7891 · listening
          </span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span>User-scope marker integrity</span>
          <span className="text-[11px] inline-flex items-center gap-1" style={{ color: "var(--success-foreground)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="size-3">
              <path d="M5 12l5 5L20 7" />
            </svg>
            start/end matched
          </span>
        </div>
      </div>
    </div>
  );
}

function ConflictBanner() {
  return (
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "rgba(245,158,11,0.4)" }}>
      <div className="px-4 py-3 flex items-start gap-3" style={{ background: "rgba(245,158,11,0.08)" }}>
        <div className="size-9 rounded-full grid place-items-center mt-0.5" style={{ background: "rgba(245,158,11,0.2)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" style={{ color: "var(--warning-foreground)" }}>
            <path d="M10.3 3.86a2 2 0 013.4 0l8 14A2 2 0 0120 21H4a2 2 0 01-1.7-3.14z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--warning-foreground)" }}>
            You already have hooks at user scope.
          </p>
          <p className="text-xs mt-1">
            Nora detected hooks in <code className="font-mono px-1 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>~/.claude/settings.json</code> without nora's marker. Nora will <strong>append below</strong> your existing hooks, wrapped in a marker block. Your pre-existing lines are never modified.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
            <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--warning-foreground)" }}>
              # nora:hooks:start
            </span>
            <span style={{ color: "var(--muted-foreground)" }}>...nora's hooks...</span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--warning-foreground)" }}>
              # nora:hooks:end
            </span>
          </div>
        </div>
      </div>
      <div className="border-t" style={{ borderColor: "rgba(245,158,11,0.25)" }}>
        <div className="px-4 py-2 flex items-center justify-between text-[11px] border-b" style={{ borderColor: "rgba(245,158,11,0.15)", background: "rgba(255,255,255,0.6)" }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">Show diff</span>
            <span className="font-mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              ~/.claude/settings.json
            </span>
          </span>
          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <span style={{ color: "var(--success)" }}>+12</span> · 0 modifications to existing lines
          </span>
        </div>
        <pre className="text-[11px] font-mono leading-relaxed p-3 overflow-x-auto" style={{ background: "var(--card)" }}>
          <code>
            <span style={{ color: "var(--muted-foreground)" }}>{` {
   "hooks": {
     "PostToolUse": [
       {
         "matcher": "Bash",
         "hooks": [{ "type": "command", "command": "your-existing-bash-hook" }]
       },
`}</span>
            <span style={{ background: "rgba(16,185,129,0.10)", display: "block" }}>
              <span style={{ color: "var(--success)" }}>{`+      // nora:hooks:start`}</span>
            </span>
            <span style={{ background: "rgba(16,185,129,0.10)", display: "block" }}>
              <span style={{ color: "var(--success)" }}>{`+      { "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s http://127.0.0.1:7891/hooks" }] },`}</span>
            </span>
            <span style={{ background: "rgba(16,185,129,0.10)", display: "block" }}>
              <span style={{ color: "var(--success)" }}>{`+      // nora:hooks:end`}</span>
            </span>
            <span style={{ color: "var(--muted-foreground)" }}>{`     ],
     "SessionStart": [ ... ],
     "Stop": [ ... ]
   }
 }`}</span>
          </code>
        </pre>
      </div>
      <div className="px-4 py-3 flex items-center justify-end gap-2 border-t" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(255,255,255,0.6)" }}>
        <button className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
          Skip — install manually
        </button>
        <button className="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
          Open settings.json
        </button>
        <button className="px-4 py-1.5 rounded-md text-xs font-medium text-white shadow-sm" style={{ background: "var(--primary)" }}>
          Continue — append marker block
        </button>
      </div>
    </div>
  );
}
