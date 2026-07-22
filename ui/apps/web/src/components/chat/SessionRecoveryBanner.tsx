/**
 * SessionRecoveryBanner — surfaces SDK-loop crashes during a chat.
 *
 * The bridge keeps the session in memory across SDK failures and
 * attempts an auto-respawn (`resume:`) with backoff. This banner is
 * the user's window into that machinery:
 *
 *   • lifecycle === "recovering" → soft yellow notice; no button.
 *     The bridge will retry automatically; user input typed during
 *     this window is buffered server-side and replayed on respawn.
 *   • lifecycle === "failed"     → hard red notice with a Retry
 *     button. The bridge has exhausted auto-attempts; the click
 *     emits `retry-session` and the schedule starts over.
 *
 * Distinct from the snackbar error surface, which shows transient
 * server-emitted error frames (e.g. malformed request payloads) that
 * don't break the session.
 */
import type { SessionLifecycle } from "../../lib/chat-types";

export interface SessionRecoveryBannerProps {
  lifecycle: SessionLifecycle;
  recoveryAttempt: number;
  maxAttempts: number;
  lastError: string | null;
  onRetry: () => void;
}

export function SessionRecoveryBanner({
  lifecycle,
  recoveryAttempt,
  maxAttempts,
  lastError,
  onRetry,
}: SessionRecoveryBannerProps) {
  if (lifecycle === "active") return null;

  const isFailed = lifecycle === "failed";
  const headline = isFailed
    ? "Session recovery failed"
    : `Reconnecting… (attempt ${recoveryAttempt} of ${maxAttempts})`;

  return (
    <div
      role="alert"
      data-testid="session-recovery-banner"
      data-lifecycle={lifecycle}
      className="mx-5 mb-2 px-3 py-2 rounded-md text-[12px] flex items-start gap-3"
      style={{
        background: isFailed ? "rgba(239,68,68,0.10)" : "rgba(234,179,8,0.10)",
        color: isFailed ? "var(--destructive-foreground)" : "var(--foreground)",
        border: isFailed
          ? "1px solid rgba(239,68,68,0.25)"
          : "1px solid rgba(234,179,8,0.25)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium">{headline}</div>
        {lastError ? (
          <div className="opacity-80 mt-0.5 break-words">{lastError}</div>
        ) : null}
        {!isFailed ? (
          <div className="opacity-70 mt-0.5">
            Anything you type now will be sent once the session is back.
          </div>
        ) : null}
      </div>
      {isFailed ? (
        <button
          type="button"
          data-testid="session-retry-button"
          onClick={onRetry}
          className="shrink-0 px-2 py-1 rounded font-medium hover:bg-black/10"
          style={{
            background: "rgba(239,68,68,0.18)",
            color: "var(--destructive-foreground)",
            border: "1px solid rgba(239,68,68,0.30)",
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
