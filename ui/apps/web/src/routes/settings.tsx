import { Link } from "wouter";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

interface SettingsProps {
  /** "default" (live) | "conflict" (static design mockup) */
  variant: string;
}

interface HooksStatus {
  settingsPath: string;
  settingsExists: boolean;
  installed: boolean;
  hasMarker: boolean;
  hasUserHooks: boolean;
  receiverPort: number;
  eventsWired: string[];
  installedAt: string | null;
  lastDelivered: { channel: string; at: string } | null;
}

const NAV: Array<{ id: string; label: string; tag?: { label: string; tone: "ok" | "info" } }> = [
  { id: "workspace", label: "Workspace" },
  { id: "hooks", label: "Hooks", tag: { label: "ok", tone: "ok" } },
  { id: "worktrees", label: "Worktrees" },
  { id: "auth", label: "Auth", tag: { label: "claude", tone: "ok" } },
  { id: "about", label: "About" },
];

export function Settings({ variant }: SettingsProps) {
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
          loom v0.1
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
          {variant === "conflict" ? <StaticConflictDemo /> : <LiveHooks />}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            Live panel                              */
/* ------------------------------------------------------------------ */

function LiveHooks() {
  const [status, setStatus] = useState<HooksStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"install" | "uninstall" | "reveal" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/hooks/status", { signal: ctrl.signal });
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as HooksStatus;
      setStatus(data);
      setLoadError(null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setLoadError(e?.message ?? "fetch failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [refresh]);

  const doAction = useCallback(
    async (kind: "install" | "uninstall" | "reveal") => {
      setBusy(kind);
      setActionError(null);
      try {
        const res = await fetch(`/api/hooks/${kind}`, { method: "POST" });
        if (!res.ok) {
          const body = await res.text();
          setActionError(`${kind} failed: HTTP ${res.status}${body ? ` — ${body}` : ""}`);
          return;
        }
        if (kind !== "reveal") {
          const data = (await res.json()) as HooksStatus;
          setStatus(data);
        }
      } catch (e: any) {
        setActionError(e?.message ?? `${kind} failed`);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  if (loadError && !status) {
    return (
      <div className="rounded-xl border p-4" style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.04)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--destructive-foreground)" }}>Could not load hook status.</p>
        <p className="text-[11px] mt-0.5 font-mono" style={{ color: "var(--muted-foreground)" }}>{loadError}</p>
        <button onClick={refresh} className="mt-2 text-[11px] px-2 py-1 rounded border" style={{ borderColor: "var(--border)" }}>Retry</button>
      </div>
    );
  }
  if (!status) {
    return <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Checking hook state…</div>;
  }

  const showConflict = status.hasUserHooks && !status.hasMarker;
  const showInstalled = status.hasMarker;
  const showNotInstalled = !status.hasMarker && !status.hasUserHooks;

  return (
    <>
      {showInstalled && (
        <InstalledBanner
          status={status}
          busy={busy}
          onReinstall={() => doAction("install")}
          onUninstall={() => doAction("uninstall")}
        />
      )}
      {showNotInstalled && (
        <NotInstalledBanner status={status} busy={busy} onInstall={() => doAction("install")} />
      )}
      {showConflict && (
        <ConflictBanner
          status={status}
          busy={busy}
          onContinue={() => doAction("install")}
          onReveal={() => doAction("reveal")}
        />
      )}
      {actionError && (
        <div className="rounded-md border px-3 py-2 text-[11px]" style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.04)", color: "var(--destructive-foreground)" }}>
          {actionError}
        </div>
      )}
      <WiredEvents events={status.eventsWired} dim={showConflict} />
      {showInstalled && <MarkerBlock status={status} />}
      {showInstalled && <Diagnostics status={status} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*                            Banners                                 */
/* ------------------------------------------------------------------ */

function InstalledBanner({
  status,
  busy,
  onReinstall,
  onUninstall,
}: {
  status: HooksStatus;
  busy: "install" | "uninstall" | "reveal" | null;
  onReinstall: () => void;
  onUninstall: () => void;
}) {
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
            marker: loom:hooks
          </span>
        </div>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {status.installedAt ? `Installed ${formatTimestamp(status.installedAt)} · ` : ""}
          {status.eventsWired.length} events wired · receiver port {status.receiverPort}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onReinstall}
          disabled={busy !== null}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border hover:bg-[var(--accent)] disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
        >
          {busy === "install" ? "Reinstalling…" : "Reinstall"}
        </button>
        <button
          onClick={onUninstall}
          disabled={busy !== null}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border disabled:opacity-50"
          style={{ borderColor: "rgba(239,68,68,0.4)", color: "var(--destructive-foreground)" }}
        >
          {busy === "uninstall" ? "Uninstalling…" : "Uninstall"}
        </button>
      </div>
    </div>
  );
}

function NotInstalledBanner({
  status,
  busy,
  onInstall,
}: {
  status: HooksStatus;
  busy: "install" | "uninstall" | "reveal" | null;
  onInstall: () => void;
}) {
  return (
    <div className="rounded-xl border p-4 flex items-start gap-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="size-8 rounded-full grid place-items-center" style={{ background: "var(--muted)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" style={{ color: "var(--muted-foreground)" }}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">Hooks not installed.</p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          {status.settingsExists
            ? "Your ~/.claude/settings.json has no loom marker. Installing adds one and leaves everything else untouched."
            : "No ~/.claude/settings.json yet. Installing will create one with loom's hook block."}
        </p>
      </div>
      <button
        onClick={onInstall}
        disabled={busy !== null}
        className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-50"
        style={{ background: "var(--primary)" }}
      >
        {busy === "install" ? "Installing…" : "Install"}
      </button>
    </div>
  );
}

function ConflictBanner({
  status,
  busy,
  onContinue,
  onReveal,
}: {
  status: HooksStatus;
  busy: "install" | "uninstall" | "reveal" | null;
  onContinue: () => void;
  onReveal: () => void;
}) {
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
            Loom detected hooks in <code className="font-mono px-1 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>{status.settingsPath}</code> without loom's marker. Continue and loom will <strong>append below</strong> your existing hooks, wrapped in a marker block. Your pre-existing lines are never modified.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
            <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--warning-foreground)" }}>
              # loom:hooks:start
            </span>
            <span style={{ color: "var(--muted-foreground)" }}>...loom's hooks...</span>
            <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--warning-foreground)" }}>
              # loom:hooks:end
            </span>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 flex items-center justify-end gap-2 border-t" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(255,255,255,0.6)" }}>
        <button
          onClick={onReveal}
          disabled={busy !== null}
          className="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-[var(--accent)] disabled:opacity-50"
          style={{ borderColor: "var(--border)" }}
        >
          Open settings.json
        </button>
        <button
          onClick={onContinue}
          disabled={busy !== null}
          className="px-4 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-50"
          style={{ background: "var(--primary)" }}
        >
          {busy === "install" ? "Appending…" : "Continue — append marker block"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                        Wired events / Marker / Diagnostics         */
/* ------------------------------------------------------------------ */

function WiredEvents({ events, dim }: { events: string[]; dim?: boolean }) {
  return (
    <div className={dim ? "opacity-50" : ""}>
      <h2 className="text-xs font-medium mb-2">
        Wired events {dim && <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>(after install)</span>}
      </h2>
      <div className="grid grid-cols-2 gap-1.5">
        {events.map((e) => (
          <div key={e} className="px-3 py-2 rounded-md border flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
            <span className="size-1.5 rounded-full" style={{ background: dim ? "var(--muted-foreground)" : "var(--success)" }} />
            <code className="font-mono text-[11px]">{e}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkerBlock({ status }: { status: HooksStatus }) {
  return (
    <div>
      <h2 className="text-xs font-medium mb-2 flex items-center gap-2">
        Installed marker block <span className="text-[10px] font-mono px-1 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>SR-39</span>
      </h2>
      <p className="text-[11px] mb-2" style={{ color: "var(--muted-foreground)" }}>
        loom appends its hooks below your existing hooks wrapped in this marker. Uninstall removes only this block.
      </p>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <div className="px-3 py-1.5 border-b flex items-center justify-between text-[10px] font-mono" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.012)" }}>
          <span>{status.settingsPath}</span>
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
            <span style={{ color: "var(--info-foreground)", fontWeight: 600 }}>      // loom:hooks:start</span>
            <span style={{ color: "var(--success-foreground)" }}>      ← block start{"\n"}</span>
            <span style={{ background: "rgba(16,185,129,0.06)", display: "block", padding: "0 0.4rem", borderLeft: "2px solid var(--success)" }}>
              {`      { "type": "command", "command": "curl -s http://127.0.0.1:${status.receiverPort}/hooks/event" },`}
            </span>
            <span style={{ color: "var(--info-foreground)", fontWeight: 600 }}>      // loom:hooks:end</span>
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

function Diagnostics({ status }: { status: HooksStatus }) {
  const last = status.lastDelivered;
  return (
    <div>
      <h2 className="text-xs font-medium mb-2">Diagnostics</h2>
      <div className="rounded-lg border divide-y" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span>Last hook delivered</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            {last ? `${last.channel} · ${formatRelative(last.at)}` : "no events yet"}
          </span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          <span>Receiver socket</span>
          <span className="font-mono text-[11px]" style={{ color: "var(--success-foreground)" }}>
            127.0.0.1:{status.receiverPort} · listening
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

/* ------------------------------------------------------------------ */
/*                      Static conflict mockup (demo)                 */
/* ------------------------------------------------------------------ */

function StaticConflictDemo() {
  return (
    <>
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
              Loom detected hooks in <code className="font-mono px-1 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>~/.claude/settings.json</code> without loom's marker. Loom will <strong>append below</strong> your existing hooks, wrapped in a marker block. Your pre-existing lines are never modified.
            </p>
          </div>
        </div>
      </div>
      <WiredEvents events={["PostToolUse", "SessionStart", "Stop", "SubagentStop", "PermissionRequest"]} dim />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*                              Formatters                            */
/* ------------------------------------------------------------------ */

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatTimestamp(iso);
}
