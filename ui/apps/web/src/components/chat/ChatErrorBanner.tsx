/**
 * Sticky error banner rendered above the composer. The banner is
 * sticky in the sense that it survives `snapshot` server frames —
 * the only ways to leave the banner state are explicit dismiss or
 * a new error arriving (which overwrites with `dismissed: false`).
 *
 * Render policy lives in `live-chat.tsx`: the route renders this
 * component iff `state.error && !state.error.dismissed`. The dismiss
 * button fires the parent's `onDismiss`, which dispatches a
 * `dismiss-error` action setting `state.error.dismissed = true`.
 */
export interface ChatErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ChatErrorBanner({ message, onDismiss }: ChatErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid="chat-error-banner"
      className="mx-5 mb-2 px-3 py-2 rounded-md text-[12px] flex items-start gap-2"
      style={{
        background: "rgba(239,68,68,0.08)",
        color: "var(--destructive-foreground)",
      }}
    >
      <span className="flex-1 break-words">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 size-5 grid place-items-center rounded hover:bg-black/10"
        style={{ color: "var(--destructive-foreground)" }}
      >
        ×
      </button>
    </div>
  );
}
