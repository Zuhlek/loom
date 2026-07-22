/**
 * Shared presentational primitives for the settings surfaces — the
 * per-chat {@link ChatSettingsModal} and the new-chat spawn dialog. Kept
 * in one place so both dialogs read as one visual system: uppercase
 * section labels, and a selectable card with a primary-accent active
 * state. Theme-aware throughout (surfaces/text via CSS vars).
 */
import type { ReactNode } from "react";
import clsx from "clsx";

/** A labelled settings section — small uppercase caption + its body. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div
        className="pb-1.5 text-[10px] uppercase tracking-wide font-medium"
        style={{ color: "var(--muted-foreground)" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * A full-width selectable row: optional leading icon, a label, and an
 * optional description. Active state paints a primary border + accent
 * fill. Used for permission/mode pickers across the settings surfaces.
 */
export function OptionCard({
  active,
  onClick,
  icon,
  label,
  description,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  description?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "w-full text-left px-3 py-2 rounded-lg border flex items-start gap-2.5",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
      style={{ borderColor: active ? "var(--primary)" : "var(--border)" }}
      data-testid={testId}
    >
      {icon ? (
        <span className="mt-0.5 shrink-0" style={{ color: "var(--muted-foreground)" }}>
          {icon}
        </span>
      ) : null}
      <span className="flex flex-col">
        <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
          {label}
        </span>
        {description ? (
          <span className="text-[11px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
