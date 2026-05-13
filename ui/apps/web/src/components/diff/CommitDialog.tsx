/**
 * CommitDialog — inline commit-message composer for the Diff panel.
 *
 * Placement mirrors `AskUserQuestionPicker`: docked inline above the
 * diff list, NOT a modal. The owning `DiffPanelContainer` decides
 * when to mount it via `state.dialog`.
 *
 * Intents: "commit" / "commit-push" / "pr". The dialog itself does
 * not branch on the intent for the field set — every intent uses
 * the same `message` (required) + optional `body` shape. The intent
 * lives on `CommitDialogProps` so the title / Confirm-button copy
 * can reflect the chained action that will follow on confirm.
 */
import { useState } from "react";

export type CommitDialogIntent = "commit" | "commit-push" | "pr";

export interface CommitDialogProps {
  intent: CommitDialogIntent;
  initialMessage?: string;
  initialBody?: string;
  onConfirm: (input: { message: string; body?: string }) => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string;
}

function intentTitle(intent: CommitDialogIntent): string {
  switch (intent) {
    case "commit":
      return "Commit";
    case "commit-push":
      return "Commit & push";
    case "pr":
      return "Commit & create PR";
  }
}

function intentConfirmLabel(intent: CommitDialogIntent, busy: boolean): string {
  if (busy) {
    switch (intent) {
      case "commit":
        return "Committing…";
      case "commit-push":
        return "Pushing…";
      case "pr":
        return "Creating PR…";
    }
  }
  switch (intent) {
    case "commit":
      return "Commit";
    case "commit-push":
      return "Commit & push";
    case "pr":
      return "Create PR";
  }
}

export function CommitDialog(props: CommitDialogProps) {
  const { intent, onConfirm, onCancel, busy, error } = props;
  const [message, setMessage] = useState<string>(props.initialMessage ?? "");
  const [body, setBody] = useState<string>(props.initialBody ?? "");

  const handleConfirm = (): void => {
    if (busy === true || message.trim() === "") return;
    const trimmedBody = body.trim();
    if (trimmedBody.length > 0) {
      onConfirm({ message, body });
    } else {
      onConfirm({ message });
    }
  };

  return (
    <div
      className="rounded-xl border-2 overflow-hidden"
      style={{ borderColor: "var(--primary)", background: "rgba(59,130,246,0.04)" }}
      data-testid="commit-dialog"
      data-intent={intent}
    >
      <div
        className="px-4 py-2.5 flex items-center gap-2 border-b"
        style={{ borderColor: "rgba(59,130,246,0.25)" }}
      >
        <span
          className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded"
          style={{ background: "rgba(59,130,246,0.18)", color: "var(--info-foreground)" }}
        >
          {intentTitle(intent)}
        </span>
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          Compose the commit message
        </span>
      </div>

      <div className="px-4 py-3 space-y-2">
        <label className="block">
          <span
            className="text-[10px] uppercase tracking-wide font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            Subject
          </span>
          <textarea
            rows={2}
            placeholder="Brief summary of the change…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy === true}
            className="mt-1 w-full px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none resize-none disabled:opacity-60"
            style={{ borderColor: "var(--border)" }}
            data-testid="commit-dialog-message"
          />
        </label>

        <label className="block">
          <span
            className="text-[10px] uppercase tracking-wide font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            Body (optional)
          </span>
          <textarea
            rows={3}
            placeholder="Longer description, motivation, breaking changes…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy === true}
            className="mt-1 w-full px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none resize-none disabled:opacity-60"
            style={{ borderColor: "var(--border)" }}
            data-testid="commit-dialog-body"
          />
        </label>

        {error && (
          <div
            className="text-[11px] rounded-md px-2 py-1.5"
            style={{
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "var(--destructive-foreground)",
            }}
            role="alert"
            data-testid="commit-dialog-error"
          >
            {error}
          </div>
        )}
      </div>

      <div
        className="px-4 pb-3 pt-2 border-t flex items-center justify-end gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={busy === true}
          className="text-[11px] px-2 py-1 rounded hover:bg-[var(--accent)] disabled:opacity-50"
          style={{ color: "var(--muted-foreground)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy === true || message.trim() === ""}
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
          style={{ background: "var(--primary)" }}
          data-testid="commit-dialog-confirm"
        >
          {busy === true && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="size-3 animate-spin"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          {intentConfirmLabel(intent, busy === true)}
        </button>
      </div>
    </div>
  );
}
