import clsx from "clsx";
import type { PermissionMode } from "../../lib/chat-types";

/**
 * Two-state composer pill that flips the chat's permission mode
 * between `plan` and the last non-plan mode in one click — no popup,
 * no listbox. The click dispatches the existing `permission-mode-set`
 * frame through {@link onModeChange}:
 *   - From `mode !== 'plan'` (Build) ⇒ `onModeChange('plan')`.
 *   - From `mode === 'plan'` (Plan) ⇒ `onModeChange(lastNonPlanMode)`.
 *
 * The parent ({@link ChatComposer}) owns the `lastNonPlanMode` ref so
 * the value survives mid-session flips; this component is presentation
 * only and reads it as a prop.
 *
 * Disabled iff the parent composer is hard-disabled (matches the
 * paperclip / send / permission-level pill treatment).
 */
export interface BuildPlanTogglePillProps {
  mode: PermissionMode;
  onModeChange: (next: PermissionMode) => void;
  lastNonPlanMode: PermissionMode;
  disabled?: boolean;
}

export function BuildPlanTogglePill({
  mode,
  onModeChange,
  lastNonPlanMode,
  disabled,
}: BuildPlanTogglePillProps) {
  const isPlan = mode === "plan";
  const label = isPlan ? "Plan" : "Build";
  const title = isPlan
    ? "Switch back to Build (Claude executes changes)"
    : "Switch to Plan (Claude proposes without changes)";
  const Icon = isPlan ? ClipboardListIcon : HammerIcon;

  const handleClick = () => {
    if (isPlan) onModeChange(lastNonPlanMode);
    else onModeChange("plan");
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      title={title}
      aria-pressed={isPlan}
      data-testid="composer-pill-build-plan"
      data-active={isPlan || undefined}
      className={clsx(
        "h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-xs hover:bg-[var(--accent)]",
        isPlan && "bg-[var(--accent)]",
        disabled && "opacity-50",
      )}
      style={{ color: "var(--muted-foreground)" }}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </button>
  );
}

type IconProps = { className?: string };

function HammerIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M15 12l-8.5 8.5a2.121 2.121 0 0 1-3-3L12 9" />
      <path d="M17.64 15L22 10.64" />
      <path d="M20.91 11.7l-1.25-1.25a2.5 2.5 0 0 1 0-3.54l.71-.7a2.5 2.5 0 0 0-3.54-3.54l-.7.71a2.5 2.5 0 0 1-3.54 0L11.34 2.13" />
    </svg>
  );
}

function ClipboardListIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M8 12h.01M12 12h4M8 16h.01M12 16h4" />
    </svg>
  );
}
