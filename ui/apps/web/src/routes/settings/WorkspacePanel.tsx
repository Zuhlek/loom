/**
 * WorkspacePanel — read-only view of the workspace slice of
 * `GET /settings`.
 */
import { useEffect, useState } from "react";
import { getSettings, type ApiSettings } from "../../lib/api";

export function WorkspacePanel() {
  const [data, setData] = useState<ApiSettings["workspace"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => alive && setData(s.workspace))
      .catch((e) => alive && setError(e?.message ?? "failed to load settings"));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return <PanelError message={error} />;
  }
  if (!data) {
    return <PanelLoading />;
  }
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: "var(--border)" }}
      data-testid="settings-panel-workspace"
    >
      <Field label="root" value={data.root} />
      <Field label="source" value={data.source} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </span>
      <code className="font-mono text-xs">{value}</code>
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
      Loading…
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs"
      style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}
      data-testid="settings-panel-error"
    >
      {message}
    </div>
  );
}
