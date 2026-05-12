import { useState, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { PermissionMode } from "../../lib/chat-types";

/**
 * Queue-priority value as exposed by the composer UI. Maps onto the
 * SDK's `SDKUserMessage.priority` field directly — "now" is the
 * default (no priority bump) and "next" is the queue-priority bump
 * used while a turn is running (US-007).
 */
export type ComposerQueuePriority = "now" | "next";

/**
 * T-007 / US-007. Three-state composer policy mirror — kept in sync
 * with `routes/live-chat.tsx`'s `ComposerMode` type. The composer
 * uses this to split hard-disable (blocked) from queue-while-running
 * (queue) from default-enabled (ready).
 */
export type ComposerMode = "ready" | "queue" | "blocked";

export interface ChatComposerProps {
  /**
   * T-007 / US-007. Three-state composer policy. The composer
   * hard-disables iff `composerMode === "blocked"`; the queue mode
   * changes the send affordance (label / title says "Queue") but
   * keeps the textarea + button enabled so the user can push a
   * follow-up while the turn streams. Optional for backwards-compat
   * during a transition window — when omitted the composer falls
   * back to the legacy `disabled` boolean derivation.
   */
  composerMode?: ComposerMode;
  /** Disabled when there is a pending AskUserQuestion or PermissionRequest. */
  disabled?: boolean;
  disabledReason?: string;
  /** Compact narrows for the worktree-mode pane. */
  compact?: boolean;
  /** Called when the user submits a turn. */
  onSubmit?: (text: string, priority: ComposerQueuePriority) => void;
  /** When true, the running turn is interruptable — shows a stop button. */
  isRunning?: boolean;
  onInterrupt?: () => void;

  /**
   * US-004. Permission-mode selector (always visible). The parent
   * supplies the current mode + the dispatcher; the composer emits the
   * selected mode through `onPermissionModeChange` and the route
   * forwards it to the bridge via a `permission-mode-set` frame.
   */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;

  /**
   * US-004 / US-007. Queue-priority selector. The control is rendered
   * iff a turn is in flight (`isRunning === true`) — per ADR-002 the
   * footer stays minimal when there's nothing to prioritise — but the
   * prop is always supplied by the parent so the reducer state is
   * authoritative even while the control is hidden.
   */
  queuePriority?: ComposerQueuePriority;
  onQueuePriorityChange?: (priority: ComposerQueuePriority) => void;

  /**
   * US-005. When true (parent derives from `turnState === "interrupted"`)
   * the composer renders a distinct amber "Interrupted" pill adjacent
   * to the Stop/Send control. The pill is informational; the SDK's
   * implicit re-prime resumes the cancelled turn when the next user
   * message arrives via `UserMessageQueue`.
   */
  isInterrupted?: boolean;
}

const PERMISSION_MODES: ReadonlyArray<{ value: PermissionMode; label: string }> = [
  { value: "default", label: "default" },
  { value: "plan", label: "plan" },
  { value: "acceptEdits", label: "acceptEdits" },
  { value: "bypassPermissions", label: "bypassPermissions" },
];

export function ChatComposer({
  composerMode,
  disabled,
  disabledReason,
  compact,
  onSubmit,
  isRunning,
  onInterrupt,
  permissionMode = "default",
  onPermissionModeChange,
  queuePriority = "now",
  onQueuePriorityChange,
  isInterrupted,
}: ChatComposerProps) {
  // T-007 / US-007. Resolve the hard-disable + send-affordance flags
  // from the three-state composer mode. When `composerMode` is
  // omitted the legacy `disabled` boolean is the only signal — that
  // path keeps the pre-T-007 behaviour for any caller that hasn't
  // adopted the new prop yet.
  const isBlocked = composerMode === "blocked";
  const isQueueMode = composerMode === "queue";
  // The textarea + send button hard-disable iff the composer is in
  // the blocked state OR the legacy `disabled` boolean is true.
  // In `"queue"` and `"ready"` modes the composer stays enabled even
  // if `disabled` is left undefined (default) — the parent now
  // sources the boolean from `composerMode === "blocked"` so the two
  // are consistent (see `live-chat.tsx`).
  const hardDisabled = isBlocked || !!disabled;
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || !onSubmit) return;
    onSubmit(text, queuePriority);
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

  const onPermissionSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onPermissionModeChange) return;
    const next = e.target.value as PermissionMode;
    onPermissionModeChange(next);
  };

  const onPrioritySelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onQueuePriorityChange) return;
    const next = e.target.value as ComposerQueuePriority;
    onQueuePriorityChange(next);
  };

  return (
    <div className={clsx("pt-1.5", compact ? "px-4 pb-4" : "px-5 pb-5")}>
      <div
        className={clsx(
          "mx-auto rounded-xl border",
          compact ? "max-w-2xl" : "max-w-3xl",
          hardDisabled ? "opacity-50" : "",
        )}
        style={{ borderColor: "var(--border)", background: hardDisabled ? "var(--muted)" : "var(--card)" }}
      >
        <div className="px-3 py-2.5">
          <textarea
            ref={taRef}
            rows={2}
            disabled={hardDisabled}
            placeholder={hardDisabled ? disabledReason ?? "Locked — resolve above" : isQueueMode ? "Queue a follow-up for Claude… (Shift+Enter for new line)" : "Reply to Claude… (Shift+Enter for new line)"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-[var(--muted-foreground)]/60"
          />
        </div>
        <div className="px-2 pb-2 flex items-center gap-1.5">
          <button
            disabled={hardDisabled}
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
                disabled={hardDisabled}
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
          {/*
           * US-004. Permission-mode selector lives immediately to the
           * right of the "claude" label per ADR-002 — a deliberate
           * stretch, NOT a generalised control-panel. Always visible
           * regardless of turn state so the user can pre-set the mode
           * for the next turn while one is still running.
           */}
          <select
            value={permissionMode}
            onChange={onPermissionSelectChange}
            disabled={hardDisabled || !onPermissionModeChange}
            className="ml-1 text-[10px] font-mono rounded border bg-transparent px-1 py-0.5"
            style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            title="Permission mode"
            aria-label="Permission mode"
            data-testid="permission-mode-select"
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {/*
           * US-004 AC3 / US-007. Queue-priority control. Only rendered
           * while a turn is running — when the composer is in "ready"
           * the submit always carries `priority: "now"` and the toggle
           * would be a no-op.
           */}
          {isRunning && (
            <select
              value={queuePriority}
              onChange={onPrioritySelectChange}
              disabled={hardDisabled || !onQueuePriorityChange}
              className="ml-1 text-[10px] font-mono rounded border bg-transparent px-1 py-0.5"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
              title="Queue priority"
              aria-label="Queue priority"
              data-testid="queue-priority-select"
            >
              <option value="now">normal</option>
              <option value="next">next</option>
            </select>
          )}
          {/*
           * US-005. The "Interrupted" pill surfaces the existing
           * `turnState === "interrupted"` state visually — the SDK
           * implicitly re-primes the cancelled turn when the next
           * user message arrives via `UserMessageQueue`, so the pill
           * is purely informational (no buttons). It sits left of
           * the Stop/Send control and disappears when `turnState`
           * transitions back to `"running"` / `"idle"`.
           *
           * a11y: `role="status"` makes it a live region so screen
           * readers announce the interrupted transition; the
           * `aria-label` + `title` carry the resume-affordance copy
           * since the pill has no visible button.
           *
           * Color: amber warning palette (non-error informational)
           * via the loom theme's `--warning` / `--warning-foreground`
           * CSS variables, with a hard-coded amber fallback so the
           * pill is visible even on themes that haven't defined the
           * tokens yet.
           */}
          {isInterrupted && (
            <span
              role="status"
              aria-label="Interrupted. Send a message to continue from where Claude paused."
              title="Send a message to continue from where Claude paused."
              className="ml-1 text-[10px] font-mono rounded px-1.5 py-0.5 bg-amber-700 text-amber-100"
              style={{
                background: "var(--warning, #b45309)",
                color: "var(--warning-foreground, #fef3c7)",
              }}
              data-testid="interrupted-pill"
            >
              Interrupted
            </span>
          )}
          {/*
           * Stop button: visible whenever the turn is running and the
           * parent supplied an `onInterrupt`. Previously this branch
           * also hid the Send button — T-007 splits that into the
           * "queue" path where the Send button surfaces as "Queue"
           * adjacent to Stop so the user can both interrupt and push
           * a queued follow-up. The blocked path (resolved by the
           * inline permission / question picker above the composer)
           * keeps hiding the Send button by leaning on the `hardDisabled`
           * derivation below.
           */}
          {isRunning && onInterrupt && (
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
          )}
          {/*
           * Send / Queue button. Hidden when the composer is hard-
           * disabled (`composerMode === "blocked"` or the legacy
           * `disabled` boolean) — the inline permission / question
           * picker above the composer is the primary interaction
           * surface in that state, mirroring the previous behaviour
           * where the Stop button replaced Send while running.
           *
           * In `composerMode === "queue"` the affordance label flips
           * to "Queue" (US-007 AC2) — the visible icon label, the
           * `title`, and the `aria-label` all carry the queued-affordance
           * copy so screen readers + tooltips agree. The button still
           * routes through the same `submit` handler; the parent
           * decides whether the outgoing wire frame carries
           * `priority: "next"` or `priority: "now"` based on
           * `composerMode` (see `live-chat.tsx` `effectiveQueuePriority`).
           */}
          {!hardDisabled && !isQueueMode && (
            <button
              type="button"
              onClick={submit}
              disabled={value.trim().length === 0}
              className={clsx(
                "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                value.trim().length === 0 && "opacity-50",
              )}
              style={{ background: "var(--primary)" }}
              title="Send (Enter)"
              aria-label="Send message"
              data-testid="composer-send-button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {!hardDisabled && isQueueMode && (
            <button
              type="button"
              onClick={submit}
              disabled={value.trim().length === 0}
              className={clsx(
                "ml-2 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-white shadow-sm",
                value.trim().length === 0 && "opacity-50",
              )}
              style={{ background: "var(--primary)" }}
              title="Queue (Enter) — pushes ahead of the running turn"
              aria-label="Queue message"
              data-testid="composer-queue-button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
              <span>Queue</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
