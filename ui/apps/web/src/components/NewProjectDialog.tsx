/**
 * NewProjectDialog — project-first creation entrypoint. Asks for a project
 * name and an initial cwd; on submit POSTs /api/projects.
 *
 * If the backend reports a 409 (name already taken) we surface an inline
 * error and offer a one-click action to switch the user to the existing
 * project (caller decides what "switch" means via `onUseExisting`).
 */
import { useEffect, useState } from "react";
import { ApiError, createProject, listCwdRoots, type ApiProject } from "../lib/api";
import { useSidebarState } from "../lib/sidebar-state";
import { CwdPicker } from "./CwdPicker";

interface Props {
  onClose: () => void;
  onCreated?: (project: ApiProject) => void;
  /**
   * Called when the user wants to reuse an already-existing project (the
   * "Use existing" link in the duplicate-name error). The caller is expected
   * to dismiss the dialog and route the user appropriately.
   */
  onUseExisting?: (project: ApiProject) => void;
}

export function NewProjectDialog({ onClose, onCreated, onUseExisting }: Props) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ApiProject | null>(null);
  const { refresh } = useSidebarState();

  // Seed the cwd from /api/cwd/roots so the field has a working default.
  useEffect(() => {
    if (cwd) return;
    let alive = true;
    listCwdRoots()
      .then((r) => {
        if (!alive) return;
        const preferred = ["dev", "code", "Projects"];
        for (const label of preferred) {
          const found = r.roots.find((root) => root.label === label);
          if (found) {
            setCwd(found.path);
            return;
          }
        }
        if (r.home) setCwd(r.home);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError(null);
    setDuplicate(null);
    if (!name.trim()) {
      setError("name is required");
      return;
    }
    if (!cwd.trim()) {
      setError("initial cwd is required");
      return;
    }
    setBusy(true);
    try {
      const result = await createProject({ name: name.trim(), initialCwd: cwd.trim() });
      await refresh();
      onCreated?.(result.project);
      onClose();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.body?.project) {
        setDuplicate(err.body.project as ApiProject);
        setError(`Project "${name.trim()}" already exists.`);
      } else {
        setError(err?.message ?? "create failed");
      }
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
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <div className="px-5 py-4 border-b flex items-center gap-2.5" style={{ borderColor: "var(--border)" }}>
          <div className="size-8 rounded-lg grid place-items-center" style={{ background: "var(--muted)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight">New project</h2>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Projects group your chats. Chats live inside a project.
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
          <div>
            <label className="text-xs font-medium">Project name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full mt-1.5 px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none"
              style={{ borderColor: "var(--border)" }}
              placeholder="e.g. loom, web-app, scratch"
            />
            <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              Letters, digits, dashes, underscores, spaces. 1–64 chars.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium">Initial working directory</label>
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
            <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              You can add more cwds to this project later.
            </p>
          </div>

          {error ? (
            <div
              className="rounded-md border px-3 py-2 text-xs"
              style={{ borderColor: "var(--destructive)", color: "var(--destructive)", background: "rgba(220,38,38,0.06)" }}
            >
              <div>{error}</div>
              {duplicate && onUseExisting ? (
                <button
                  type="button"
                  onClick={() => {
                    onUseExisting(duplicate);
                    onClose();
                  }}
                  className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border"
                  style={{ borderColor: "var(--destructive)", color: "var(--destructive)", background: "white" }}
                >
                  Open chat in existing "{duplicate.name}"
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
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
            {busy ? "Creating..." : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
