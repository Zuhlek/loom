/**
 * HooksHealthBanner — pinned top-of-viewport when loom's hook config
 * in ~/.claude/settings.json is missing or out of date. Polls
 * /api/hooks/status every 5s. Returns null on the happy path.
 *
 * Three failure modes are surfaced (in priority order):
 *
 *  1. drift          — marker installed, but the set of wired events
 *                      is a strict subset of what the installer would
 *                      write today (e.g. the user updated loom after a
 *                      previous install). One-click "Reinstall" fixes
 *                      it; the popup interceptors start working again
 *                      for the next chat turn.
 *
 *  2. not-installed  — settings.json has no loom entry at all and no
 *                      pre-existing user hooks. One-click "Install".
 *
 *  3. conflict       — settings.json has user hooks but no loom marker
 *                      (we don't auto-merge — link to Settings → Hooks
 *                      where the existing reconciliation UI lives).
 *
 * Healthy + already-installed is the silent happy path — no DOM.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";

interface HooksHealthSnapshot {
  installed: boolean;
  hasMarker: boolean;
  hasUserHooks: boolean;
  healthy: boolean;
  eventsExpected: string[];
  eventsInstalled: string[];
}

type Mode = "drift" | "not-installed" | "conflict" | "healthy" | "unknown";

function classify(s: HooksHealthSnapshot | null): Mode {
  if (!s) return "unknown";
  if (s.healthy) return "healthy";
  if (s.installed && !s.healthy) return "drift";
  if (!s.installed && s.hasUserHooks) return "conflict";
  return "not-installed";
}

function missingEvents(s: HooksHealthSnapshot): string[] {
  const have = new Set(s.eventsInstalled);
  return s.eventsExpected.filter((e) => !have.has(e));
}

export function HooksHealthBanner(): JSX.Element | null {
  const [snapshot, setSnapshot] = useState<HooksHealthSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/hooks/status", { signal: ctrl.signal });
      if (!res.ok) return;
      const data = (await res.json()) as HooksHealthSnapshot;
      setSnapshot(data);
    } catch {
      // Network failures here are handled by BackendOfflineBanner; we
      // just keep the last known snapshot.
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

  const install = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/hooks/install", { method: "POST" });
      if (!res.ok) {
        setActionError(`Install failed: HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as HooksHealthSnapshot;
      setSnapshot(data);
    } catch (e: any) {
      setActionError(e?.message ?? "Install failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const mode = classify(snapshot);
  if (mode === "healthy" || mode === "unknown") return null;

  const body = (() => {
    if (mode === "drift" && snapshot) {
      const missing = missingEvents(snapshot);
      return {
        message:
          missing.length > 0
            ? `Loom hooks are out of date — missing ${missing.join(", ")}.`
            : "Loom hooks are out of date.",
        sub: "Permission prompts and AskUserQuestion popups will not appear until you reinstall. Restart any open chats afterwards.",
        action: { label: busy ? "Reinstalling…" : "Reinstall", onClick: install },
      };
    }
    if (mode === "not-installed") {
      return {
        message: "Loom hooks not installed in ~/.claude/settings.json.",
        sub: "Permission prompts and AskUserQuestion popups won't appear in the UI until you install.",
        action: { label: busy ? "Installing…" : "Install", onClick: install },
      };
    }
    // conflict
    return {
      message: "Loom hook config conflict — user-managed hooks detected.",
      sub: "Open Settings → Hooks to review and install loom alongside your existing entries.",
      action: null as { label: string; onClick: () => void } | null,
    };
  })();

  return (
    <div
      role="status"
      data-testid="hooks-health-banner"
      data-mode={mode}
      className="fixed top-0 left-0 right-0 z-40 border-b bg-amber-50 text-amber-900"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between gap-4 text-sm">
        <div className="flex items-start gap-2 min-w-0">
          <span className="inline-block size-2 rounded-full bg-amber-500 mt-1.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium">{body.message}</div>
            <div className="text-[11px] opacity-80">
              {body.sub}
              {actionError ? <span className="ml-2 text-red-700">— {actionError}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {body.action ? (
            <button
              type="button"
              onClick={body.action.onClick}
              disabled={busy}
              className="rounded border px-2 py-1 hover:bg-amber-100 disabled:opacity-50"
              style={{ borderColor: "var(--border)" }}
            >
              {body.action.label}
            </button>
          ) : null}
          <Link
            href="/settings/hooks"
            className="rounded border px-2 py-1 hover:bg-amber-100"
            style={{ borderColor: "var(--border)" }}
          >
            Open settings
          </Link>
        </div>
      </div>
    </div>
  );
}
