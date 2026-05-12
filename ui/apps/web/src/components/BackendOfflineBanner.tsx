/**
 * BackendOfflineBanner — pinned top-of-viewport when the global
 * useHealthPoll hook reports offline. Pure presentational: receives
 * { offline, offlineSince, onRetry } and returns null when not
 * offline (so the DOM is absent on the happy path).
 */
import { useMemo } from "react";

export interface BackendOfflineBannerProps {
  offline: boolean;
  offlineSince: number | null;
  onRetry: () => void;
}

function formatOfflineSince(ms: number | null): string {
  if (ms == null) return "";
  const elapsed = Math.max(0, Date.now() - ms);
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function BackendOfflineBanner(props: BackendOfflineBannerProps): JSX.Element | null {
  const { offline, offlineSince, onRetry } = props;
  if (!offline) return null;

  const since = useMemo(() => formatOfflineSince(offlineSince), [offlineSince]);

  return (
    <div
      role="status"
      data-testid="backend-offline-banner"
      className="fixed top-0 left-0 right-0 z-50 border-b bg-red-50 text-red-900"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto max-w-5xl px-4 py-2 flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-red-500" aria-hidden />
          <span>
            Backend unreachable
            {since ? ` — last seen ${since}` : ""}.
          </span>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border px-2 py-1 hover:bg-red-100"
          style={{ borderColor: "var(--border)" }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
