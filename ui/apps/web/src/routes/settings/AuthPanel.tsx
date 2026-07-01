/**
 * AuthPanel — read-only view of the auth slice of `GET /settings`.
 */
import { useEffect, useState } from "react";
import { errorText, getSettings, type ApiSettings } from "../../lib/api";

export function AuthPanel() {
  const [data, setData] = useState<ApiSettings["auth"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => alive && setData(s.auth))
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
      data-testid="settings-panel-auth"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          loggedIn
        </span>
        <code className="font-mono text-xs">{String(data.loggedIn)}</code>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          apiKey detected
        </span>
        <code className="font-mono text-xs">{String(data.apiKeyDetected)}</code>
      </div>
      {data.apiKeyRejected ? (
        <p className="text-[11px]" style={{ color: "var(--warning-foreground)" }}>
          An ANTHROPIC_API_KEY is set in your environment but loom does not use it
          — log in via the Claude CLI for credentialed access.
        </p>
      ) : null}
      {data.message ? (
        <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          {data.message}
        </p>
      ) : null}
    </div>
  );
}
