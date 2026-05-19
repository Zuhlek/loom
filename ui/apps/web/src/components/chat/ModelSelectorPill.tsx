import { useEffect, useRef } from "react";
import clsx from "clsx";
import { ChevronDownIcon } from "./composer-pill-icons";

/**
 * Composer footer pill for the per-chat Claude model. Renders a ghost
 * trigger showing the persisted model label (or the SDK-default label
 * when the chat-row column is NULL) and opens a dropdown of available
 * Claude models on click. Picking a row invokes
 * {@link ModelSelectorPillProps.onPick} — the parent route forwards
 * the chosen identifier into a `model-settings-set` partial-patch
 * frame.
 *
 * Open state is parent-controlled so the `/model` built-in dispatch
 * inside {@link ChatComposer} can open the dropdown programmatically.
 * The popover-close pattern mirrors {@link PermissionLevelPill}
 * byte-for-byte (outside-click + Escape).
 */
export interface ModelSelectorPillProps {
  value: string | null;
  onPick: (modelId: string) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ModelRow {
  id: string;
  label: string;
}

const MODELS: ReadonlyArray<ModelRow> = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-opus-4-5", label: "Opus 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const DEFAULT_LABEL = "Claude (default)";

export function ModelSelectorPill({
  value,
  onPick,
  disabled,
  open = false,
  onOpenChange,
}: ModelSelectorPillProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      const node = wrapRef.current;
      if (!node) return;
      if (node.contains(e.target as Node)) return;
      onOpenChange?.(false);
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange?.(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onDocKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onDocKey);
    };
  }, [open, onOpenChange]);

  const active = MODELS.find((m) => m.id === value);
  const triggerLabel = active?.label ?? DEFAULT_LABEL;

  return (
    <div ref={wrapRef} className="relative" data-testid="composer-pill-model-selector">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange?.(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          "h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-xs hover:bg-[var(--accent)]",
          disabled && "opacity-50",
        )}
        style={{ color: "var(--muted-foreground)" }}
        data-testid="composer-pill-model-selector-trigger"
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Model"
          className="absolute bottom-full mb-1 left-0 z-10 min-w-48 rounded-md border shadow-md py-1"
          style={{ borderColor: "var(--border)", background: "var(--popover, var(--card))" }}
          data-testid="composer-pill-model-selector-popup"
        >
          {MODELS.map((row) => {
            const isActive = row.id === value;
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onPick(row.id);
                  onOpenChange?.(false);
                }}
                className={clsx(
                  "w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-[var(--accent)]",
                  isActive && "bg-[var(--accent)]",
                )}
                data-testid={`composer-pill-model-selector-row-${row.id}`}
              >
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--foreground)" }}
                >
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

