import { useState, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";

export interface ChatComposerProps {
  /** Disabled when there is a pending AskUserQuestion or PermissionRequest. */
  disabled?: boolean;
  disabledReason?: string;
  /** Compact narrows for the worktree-mode pane. */
  compact?: boolean;
  /** Called when the user submits a turn. */
  onSubmit?: (text: string) => void;
  /** When true, the running turn is interruptable — shows a stop button. */
  isRunning?: boolean;
  onInterrupt?: () => void;
}

export function ChatComposer({
  disabled,
  disabledReason,
  compact,
  onSubmit,
  isRunning,
  onInterrupt,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || !onSubmit) return;
    onSubmit(text);
    setValue("");
    // Restore focus so the user can keep typing without re-clicking.
    queueMicrotask(() => taRef.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={clsx("pt-1.5", compact ? "px-4 pb-4" : "px-5 pb-5")}>
      <div
        className={clsx(
          "mx-auto rounded-xl border",
          compact ? "max-w-2xl" : "max-w-3xl",
          disabled ? "opacity-50" : "",
        )}
        style={{ borderColor: "var(--border)", background: disabled ? "var(--muted)" : "var(--card)" }}
      >
        <div className="px-3 py-2.5">
          <textarea
            ref={taRef}
            rows={2}
            disabled={disabled}
            placeholder={disabled ? disabledReason ?? "Locked — resolve above" : "Reply to Claude… (Shift+Enter for new line)"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-[var(--muted-foreground)]/60"
          />
        </div>
        <div className="px-2 pb-2 flex items-center gap-1.5">
          <button
            disabled={disabled}
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            title="Attach image (not yet wired)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M21.4 11l-9 9a5.7 5.7 0 01-8-8l9-9a3.8 3.8 0 015.4 5.4l-9 9a1.9 1.9 0 11-2.7-2.7L15 7" />
            </svg>
          </button>
          {!compact && (
            <>
              <button
                disabled={disabled}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] hover:bg-[var(--accent)]"
                style={{ color: "var(--muted-foreground)" }}
                title="Slash commands (not yet wired)"
              >
                <span className="font-mono">/</span>
                <span>commands</span>
              </button>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                @-file
              </span>
            </>
          )}
          <span className="flex-1" />
          {!compact && (
            <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              claude
            </span>
          )}
          {isRunning && onInterrupt ? (
            <button
              type="button"
              onClick={onInterrupt}
              className="ml-2 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-white shadow-sm"
              style={{ background: "var(--destructive)" }}
              title="Interrupt the running turn"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || value.trim().length === 0}
              className={clsx(
                "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                (disabled || value.trim().length === 0) && "opacity-50",
              )}
              style={{ background: "var(--primary)" }}
              title="Send (Enter)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
