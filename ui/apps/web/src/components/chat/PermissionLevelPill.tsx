import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { PermissionMode } from "../../lib/chat-types";
import {
  ChevronDownIcon,
  LockOpenIcon,
  PenLineIcon,
  ShieldIcon,
} from "./composer-pill-icons";

/**
 * Composer footer pill for the per-chat permission mode. Renders
 * three rows — Supervised / Auto-accept edits / Full access — under
 * a ghost trigger that shows the active mode + a chevron. The `plan`
 * SDK value is intentionally absent from the rows; the Build/Plan
 * toggle pill ({@link BuildPlanTogglePill}) owns the flip into / out
 * of `plan`.
 *
 * Disabled iff the parent composer is hard-disabled (matches the
 * paperclip / send button treatment); the parent passes `disabled`
 * through.
 */
export interface PermissionLevelPillProps {
  mode: PermissionMode;
  onChange: (next: PermissionMode) => void;
  disabled?: boolean;
}

type PillModeValue = Exclude<PermissionMode, "plan">;

interface ModeRow {
  value: PillModeValue;
  label: string;
  description: string;
  Icon: (props: { className?: string }) => JSX.Element;
}

const ROWS: ReadonlyArray<ModeRow> = [
  {
    value: "default",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    Icon: ShieldIcon,
  },
  {
    value: "acceptEdits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    Icon: PenLineIcon,
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    Icon: LockOpenIcon,
  },
];

export function PermissionLevelPill({ mode, onChange, disabled }: PermissionLevelPillProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close the popup on outside click / Escape — matches the rest of the
  // composer popup affordances (slash menu, @-file menu).
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      const node = wrapRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [open]);

  // Pick the active row — fall back to the first entry (Supervised)
  // when the prop carries `plan` (Build/Plan toggle's mid-flip state)
  // or any other unexpected value, so the trigger always renders a
  // populated pill.
  const active = ROWS.find((r) => r.value === mode) ?? ROWS[0];
  const ActiveIcon = active.Icon;

  return (
    <div ref={wrapRef} className="relative" data-testid="composer-pill-permission-level">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active.description}
        className={clsx(
          "h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-xs hover:bg-[var(--accent)]",
          disabled && "opacity-50",
        )}
        style={{ color: "var(--muted-foreground)" }}
        data-testid="composer-pill-permission-level-trigger"
      >
        <ActiveIcon className="size-3.5" />
        <span>{active.label}</span>
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Permission level"
          className="absolute bottom-full mb-1 left-0 z-10 min-w-64 rounded-md border shadow-md py-1"
          style={{ borderColor: "var(--border)", background: "var(--popover, var(--card))" }}
          data-testid="composer-pill-permission-level-popup"
        >
          {ROWS.map((row) => {
            const Icon = row.Icon;
            const isActive = row.value === mode;
            return (
              <button
                key={row.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(row.value);
                  setOpen(false);
                }}
                className={clsx(
                  "w-full text-left px-2.5 py-1.5 flex items-start gap-2 hover:bg-[var(--accent)]",
                  isActive && "bg-[var(--accent)]",
                )}
                data-testid={`composer-pill-permission-level-row-${row.value}`}
              >
                <Icon className="size-3.5 mt-0.5" />
                <span className="flex flex-col">
                  <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                    {row.label}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                    {row.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

