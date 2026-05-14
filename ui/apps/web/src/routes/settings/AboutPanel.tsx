/**
 * AboutPanel — fetches `/api/health` for the app version field.
 */
import { useEffect, useState } from "react";
import { getHealth, type ApiHealth } from "../../lib/api";

export function AboutPanel() {
  const [data, setData] = useState<ApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHealth()
      .then((h) => alive && setData(h))
      .catch((e) => alive && setError(e?.message ?? "failed to load health"));
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
      data-testid="settings-panel-about"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          app
        </span>
        <code className="font-mono text-xs">loom</code>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          version
        </span>
        <code className="font-mono text-xs">{data.version}</code>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          health
        </span>
        <code className="font-mono text-xs">{data.ok ? "ok" : "degraded"}</code>
      </div>
    </div>
  );
}
