/**
 * SpawnChatModalLive — controlled spawn-chat form. POSTs to /api/chats and
 * navigates to /chat/<id> on success.
 *
 * In the project-first flow this dialog is always opened with `project`
 * pre-filled (cwd seeded from project.paths[0], project locked-in). The
 * `project: null` path is kept for legacy/internal callers that still want
 * to spawn a free-floating chat — the UI doesn't expose it directly.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { createChat, listCwdRoots, listRecentCwds, type ApiProject } from "../lib/api";
import { useSidebarState } from "../lib/sidebar-state";
import { CwdPicker } from "../components/CwdPicker";
import type { ApiChat } from "../lib/api";
import {
  LockOpenIcon,
  type ModeIconProps,
  PenLineIcon,
  ShieldIcon,
} from "../components/chat/composer-pill-icons";

type PermissionMode = ApiChat["permission_mode"];
type SpawnModeId = Exclude<PermissionMode, "plan">;

/**
 * Permission-mode catalog for the spawn-chat dialog. The `id` values
 * match the SDK's `PermissionMode` literals (camelCase) — same vocabulary
 * the composer's `PermissionLevelPill` uses, so the user sees one
 * naming scheme everywhere.
 *
 *   default            → Supervised        (ShieldIcon)
 *   acceptEdits        → Auto-accept edits (PenLineIcon)
 *   bypassPermissions  → Full access       (LockOpenIcon)
 *
 * `plan` is deliberately absent: the composer treats it as a
 * mid-session toggle (see `BuildPlanTogglePill`), not a per-chat
 * permission preset.
 */
interface SpawnMode {
  id: SpawnModeId;
  label: string;
  subtitle: string;
  Icon: (props: ModeIconProps) => JSX.Element;
  /** Accent colour for the icon halo — preserves the original
   *  green/amber/red signalling so the cards stay visually
   *  distinct at a glance. */
  accent: string;
}

const MODES: ReadonlyArray<SpawnMode> = [
  {
    id: "default",
    label: "Supervised",
    subtitle: "Ask before commands and file changes.",
    Icon: ShieldIcon,
    accent: "var(--success)",
  },
  {
    id: "acceptEdits",
    label: "Auto-accept edits",
    subtitle: "Auto-approve edits, ask before other actions.",
    Icon: PenLineIcon,
    accent: "var(--warning)",
  },
  {
    id: "bypassPermissions",
    label: "Full access",
    subtitle:
      "Allow commands and edits without prompts. Runs with --dangerously-skip-permissions — assumes the local environment (typically a developer VM) as the trust boundary.",
    Icon: LockOpenIcon,
    accent: "var(--destructive)",
  },
];

interface Props {
  onClose: () => void;
  /** When provided, the new chat is locked to this project; cwd defaults to project.paths[0]. */
  project?: ApiProject | null;
}

export function SpawnChatModalLive({ onClose, project = null }: Props) {
  const [cwd, setCwd] = useState(project?.paths[0] ?? "");
  const [mode, setMode] = useState<SpawnModeId>("default");
  const [worktree, setWorktree] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [, navigate] = useLocation();
  const { refresh } = useSidebarState();

  useEffect(() => {
    listRecentCwds(8)
      .then((r) => setRecents(r.cwds ?? []))
      .catch(() => setRecents([]));
  }, []);

  // Default cwd to the user's likely workspace when no project is pinned.
  useEffect(() => {
    if (project) return;
    if (!cwd && recents.length > 0) setCwd(recents[0]);
  }, [recents, cwd, project]);

  // Fall back to a sensible default if there are no recents either. Pull
  // from /api/cwd/roots so the path is real (the previous heuristic of
  // /Users/<hostname>/dev produced /Users/127.0.0.1/dev under Vite).
  useEffect(() => {
    if (project) return;
    if (cwd || recents.length > 0) return;
    let alive = true;
    listCwdRoots()
      .then((r) => {
        if (!alive) return;
        // Prefer ~/dev, ~/code, ~/Projects, then home itself.
        const preferred = ["dev", "code", "Projects"];
        for (const label of preferred) {
          const found = r.roots.find((root) => root.label === label);
          if (found) {
            setCwd(found.path);
            return;
          }
        }
        // Fall back to home.
        if (r.home) setCwd(r.home);
      })
      .catch(() => {
        // Leave cwd empty — let the user type or browse rather than
        // populating with a synthetic path that may not exist.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recents, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the picker first; only the next press closes the
      // whole dialog. Same footgun-prevention as NewProjectDialog.
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen]);

  const submit = async () => {
    if (!cwd.trim()) {
      setError("cwd is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createChat({
        cwd: cwd.trim(),
        permissionMode: mode,
        worktreeMode: worktree ? "worktree" : "local",
        projectId: project?.id ?? null,
      });
      await refresh();
      onClose();
      navigate(`/chat/${result.chat.id}`);
    } catch (err: any) {
      setError(err?.message ?? "spawn failed");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 backdrop-blur-[2px] grid place-items-center px-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-xl border overflow-hidden"
        style={{ borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center gap-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="size-8 rounded-lg grid place-items-center" style={{ background: "var(--muted)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight">New chat</h2>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              {project ? `In project: ${project.name}` : "Each chat is one Claude Code PID via PTY."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {project ? (
            <div
              className="flex items-center gap-2 px-2.5 py-2 rounded-md border"
              style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.02)" }}
            >
              <span className="size-4 rounded-sm grid place-items-center text-[9px] font-bold bg-emerald-500/15 text-emerald-700 uppercase">
                {project.name.slice(0, 1)}
              </span>
              <span className="text-xs font-medium">Project: {project.name}</span>
              <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                locked
              </span>
            </div>
          ) : null}
          {project ? (
            <div>
              <label className="text-xs font-medium">Working directory</label>
              {project.paths.length > 1 ? (
                <select
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  className="mt-1.5 w-full px-2.5 py-1.5 rounded-md border bg-transparent outline-none text-sm font-mono"
                  style={{ borderColor: "var(--border)" }}
                  data-testid="cwd-path-select"
                >
                  {project.paths.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="mt-1.5 flex items-center gap-2 px-2.5 py-1.5 rounded-md border"
                  style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.02)" }}
                  data-testid="cwd-path-readonly"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5 shrink-0" style={{ color: "var(--muted-foreground)" }}>
                    <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="flex-1 text-sm font-mono truncate" title={project.paths[0]}>
                    {project.paths[0]}
                  </span>
                </div>
              )}
            </div>
          ) : (
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
                    placeholder="/path/to/project"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="px-2.5 py-1.5 rounded-md border text-xs font-medium hover:bg-[var(--accent)]"
                  style={{ borderColor: "var(--border)" }}
                >
                  {pickerOpen ? "Hide" : "Browse..."}
                </button>
              </div>
              {pickerOpen ? (
                <div className="mt-2">
                  <CwdPicker
                    value={cwd}
                    onChange={(p) => setCwd(p)}
                    onClose={() => setPickerOpen(false)}
                  />
                </div>
              ) : null}
              {recents.length > 0 ? (
                <>
                  <div className="mt-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    Recent
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {recents.map((p) => (
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
                </>
              ) : null}
            </div>
          )}

          <div>
            <label className="text-xs font-medium">Permission mode</label>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {MODES.map((m) => {
                const sel = mode === m.id;
                const ModeIcon = m.Icon;
                return (
                  <label
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className="flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer"
                    style={
                      sel
                        ? { borderWidth: 2, borderStyle: "solid", borderColor: "var(--primary)", background: "rgba(59,130,246,0.04)" }
                        : { borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }
                    }
                  >
                    {/*
                     * Mode icon in an accent-tinted halo. Replaces the
                     * coloured dot + radio dot that used to sit here;
                     * the icon is the same SVG component the composer
                     * footer renders so the two UIs stay aligned at a
                     * glance ("oh, the lock-open icon means Full access
                     * everywhere"). The halo uses `color-mix` to derive
                     * a 12% tint of the accent for the background while
                     * keeping the icon stroke at full accent for
                     * contrast.
                     */}
                    <span
                      aria-hidden="true"
                      className="size-7 shrink-0 rounded-md grid place-items-center"
                      style={{
                        background: `color-mix(in srgb, ${m.accent} 12%, transparent)`,
                        color: m.accent,
                      }}
                    >
                      <ModeIcon className="size-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-medium">{m.label}</span>
                        {/*
                         * Radio affordance — kept small and to the right
                         * so the icon can lead. The selected state still
                         * paints the primary accent so the card visibly
                         * "checks in" even before the user notices the
                         * border change.
                         */}
                        <span
                          aria-hidden="true"
                          className="size-3 rounded-full grid place-items-center shrink-0"
                          style={{
                            borderWidth: 2,
                            borderStyle: "solid",
                            borderColor: sel ? "var(--primary)" : "var(--border)",
                          }}
                        >
                          {sel && (
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: "var(--primary)" }}
                            />
                          )}
                        </span>
                      </div>
                      <p className="text-[10px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
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
              </div>
            </label>
          </div>

          {error ? (
            <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--destructive)", color: "var(--destructive)", background: "rgba(220,38,38,0.06)" }}>
              {error}
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
          <span className="text-[10px] font-mono truncate max-w-[60%]" style={{ color: "var(--muted-foreground)" }}>
            claude --cwd {cwd || "(none)"} --permission-mode {mode}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-[var(--accent)]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-60"
              style={{ background: "var(--primary)" }}
            >
              {busy ? "Spawning..." : "Spawn chat"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
