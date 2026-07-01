/**
 * WorktreesPanel — read-only view of the worktrees slice of
 * `GET /settings`.
 */
import { useEffect, useState } from "react";
import { errorText, getSettings, type ApiSettings } from "../../lib/api";

export function WorktreesPanel() {
  const [data, setData] = useState<ApiSettings["worktrees"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => alive && setData(s.worktrees))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div
        className="rounded-md border px-3 py-2 text-xs"
        style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}
        data-testid="settings-panel-error"
      >
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        Loading…
      </div>
    );
  }
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: "var(--border)" }}
      data-testid="settings-panel-worktrees"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          root
        </span>
        <code className="font-mono text-xs">{data.root ?? "(unset — defaults to <topLevel>/.loom-worktrees)"}</code>
      </div>
    </div>
  );
}
