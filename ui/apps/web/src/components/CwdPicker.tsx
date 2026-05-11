/**
 * CwdPicker — Finder-style two-column directory browser. Left column
 * shows the user's common roots (HOME, ~/dev, ...). Right column shows
 * the children of the currently selected parent, filtered to
 * directories. Clicking a directory navigates into it AND propagates
 * the selection upward via `onChange` so the spawn dialog's cwd input
 * stays in sync.
 *
 * Backed by /api/cwd?parent=<abs|~> and /api/cwd/roots. All paths are
 * absolute and inside HOME.
 */
import { useEffect, useState } from "react";
import { ApiError, listCwd, listCwdRoots, type CwdEntry } from "../lib/api";

interface Props {
  value: string;
  onChange: (path: string) => void;
  onClose?: () => void;
}

export function CwdPicker({ value, onChange, onClose }: Props) {
  const [home, setHome] = useState<string | null>(null);
  const [roots, setRoots] = useState<Array<{ label: string; path: string }>>([]);
  const [parent, setParent] = useState<string>(value || "~");
  const [entries, setEntries] = useState<CwdEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load common roots once on mount.
  useEffect(() => {
    let alive = true;
    listCwdRoots()
      .then((r) => {
        if (!alive) return;
        setHome(r.home);
        setRoots(r.roots);
        // If the current value isn't usable, seed with HOME.
        if (!value) setParent(r.home);
      })
      .catch((err) => {
        if (alive) setError(err?.message ?? "load roots failed");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load children whenever parent changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listCwd(parent)
      .then((r) => {
        if (!alive) return;
        setEntries(r.entries);
        // Keep the canonical absolute parent the server returned.
        if (r.parent !== parent) setParent(r.parent);
      })
      .catch((err) => {
        if (!alive) return;
        // Show the server's structured error message when present.
        // Falls back to err.message for unparseable failures.
        if (err instanceof ApiError) {
          const msg = err.body?.error ?? err.message;
          setError(typeof msg === "string" ? msg : "list failed");
        } else {
          setError(err?.message ?? "list failed");
        }
        setEntries([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [parent]);

  const goUp = () => {
    if (!home) return;
    if (parent === home) return;
    const parts = parent.split("/").filter(Boolean);
    parts.pop();
    const next = "/" + parts.join("/");
    setParent(next || home);
  };

  const choose = (entry: CwdEntry) => {
    // Selecting a directory updates the cwd to that directory and also
    // navigates into it so the user can pick a deeper child.
    onChange(entry.path);
    setParent(entry.path);
  };

  return (
    <div
      className="rounded-md border bg-white shadow-md"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5 border-b"
        style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.02)" }}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-mono truncate">
          <button
            onClick={goUp}
            disabled={!home || parent === home}
            className="size-5 rounded grid place-items-center hover:bg-[var(--accent)] disabled:opacity-40"
            title="Up one level"
            aria-label="Up"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="truncate">{parent}</span>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="size-5 rounded grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-[140px_1fr] max-h-[280px]">
        {/* Roots column */}
        <div
          className="overflow-y-auto border-r py-1"
          style={{ borderColor: "var(--border)" }}
        >
          {roots.map((r) => {
            const sel = parent === r.path;
            return (
              <button
                key={r.path}
                onClick={() => {
                  onChange(r.path);
                  setParent(r.path);
                }}
                className="w-full text-left px-2 py-1 text-[11px] truncate hover:bg-[var(--accent)]"
                style={sel ? { background: "var(--accent)", fontWeight: 500 } : undefined}
                title={r.path}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Children column */}
        <div className="overflow-y-auto py-1">
          {loading ? (
            <div className="px-2 py-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              loading...
            </div>
          ) : error ? (
            <div className="px-2 py-1 text-[11px]" style={{ color: "var(--destructive)" }}>
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-2 py-1 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              empty
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                onClick={() => choose(e)}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-[var(--accent)]"
                title={e.path}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="size-3 shrink-0"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span className="flex-1 truncate text-left">{e.name}</span>
                {e.hasGit ? (
                  <span
                    className="text-[9px] font-mono px-1 rounded"
                    style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
                    title="git repo"
                  >
                    git
                  </span>
                ) : null}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="size-3 shrink-0"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
