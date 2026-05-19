import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { WireModelSettings } from "../../lib/chat-types";
import { ChevronDownIcon } from "./composer-pill-icons";

/**
 * Combined reasoning + context-window pill. Trigger label format:
 * `<Reasoning> · <ContextWindow>` (e.g. `Extra High · 200k`). Click
 * opens a popup with two radio groups; each pick emits a partial
 * patch via {@link ModelSettingsPillProps.onPick}, which the route
 * forwards into a `model-settings-set` frame.
 *
 * Pill → {@link WireModelSettings} translation:
 *   Low / Medium / High / Extra High / Max ⇒ `{ effort, thinking: null }`
 *   Ultrathink ⇒ `{ effort: 'max', thinking: { type: 'enabled', budgetTokens: 32000 } }`
 *   200k ⇒ `{ contextWindow: '200k' }`
 *   1M ⇒ `{ contextWindow: '1m' }`
 *
 * Popover-close pattern mirrors {@link PermissionLevelPill}
 * (outside-click + Escape). Only the parent's `disabled` prop
 * hard-disables the pill; mid-flight clicks still emit — the next
 * `chat-update` refreshes the label, not the in-flight Query options.
 */
export interface ModelSettingsPillProps {
  value: Pick<WireModelSettings, "effort" | "thinking" | "contextWindow"> | null;
  onPick: (patch: Partial<WireModelSettings>) => void;
  disabled?: boolean;
}

type ReasoningLabel = "Low" | "Medium" | "High" | "Extra High" | "Max" | "Ultrathink";
type ContextLabel = "200k" | "1M";

interface ReasoningRow {
  label: ReasoningLabel;
  patch: Partial<WireModelSettings>;
}

interface ContextRow {
  label: ContextLabel;
  patch: Partial<WireModelSettings>;
}

/**
 * Single source of truth for the Ultrathink reasoning budget. The
 * bridge receives this value via the `thinking.budgetTokens` field on
 * the `model-settings-set` wire patch — it does not redeclare the
 * literal server-side.
 */
const ULTRATHINK_BUDGET_TOKENS = 32000;

const REASONING_ROWS: ReadonlyArray<ReasoningRow> = [
  { label: "Low", patch: { effort: "low", thinking: null } },
  { label: "Medium", patch: { effort: "medium", thinking: null } },
  { label: "High", patch: { effort: "high", thinking: null } },
  { label: "Extra High", patch: { effort: "xhigh", thinking: null } },
  { label: "Max", patch: { effort: "max", thinking: null } },
  {
    label: "Ultrathink",
    patch: {
      effort: "max",
      thinking: { type: "enabled", budgetTokens: ULTRATHINK_BUDGET_TOKENS },
    },
  },
];

const CONTEXT_ROWS: ReadonlyArray<ContextRow> = [
  { label: "200k", patch: { contextWindow: "200k" } },
  { label: "1M", patch: { contextWindow: "1m" } },
];

const DEFAULT_REASONING: ReasoningLabel = "Extra High";
const DEFAULT_CONTEXT: ContextLabel = "200k";

function deriveReasoningLabel(
  value: ModelSettingsPillProps["value"],
): ReasoningLabel {
  if (!value) return DEFAULT_REASONING;
  if (value.thinking?.type === "enabled") return "Ultrathink";
  switch (value.effort) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra High";
    case "max":
      return "Max";
    default:
      return DEFAULT_REASONING;
  }
}

function deriveContextLabel(
  value: ModelSettingsPillProps["value"],
): ContextLabel {
  if (!value) return DEFAULT_CONTEXT;
  if (value.contextWindow === "1m") return "1M";
  return DEFAULT_CONTEXT;
}

export function ModelSettingsPill({ value, onPick, disabled }: ModelSettingsPillProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  const reasoningLabel = deriveReasoningLabel(value);
  const contextLabel = deriveContextLabel(value);

  return (
    <div ref={wrapRef} className="relative" data-testid="composer-pill-model-settings">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(
          "h-7 px-2 rounded-md inline-flex items-center gap-1.5 text-xs hover:bg-[var(--accent)]",
          disabled && "opacity-50",
        )}
        style={{ color: "var(--muted-foreground)" }}
        data-testid="composer-pill-model-settings-trigger"
      >
        <span>{`${reasoningLabel} · ${contextLabel}`}</span>
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Model settings"
          className="absolute bottom-full mb-1 left-0 z-10 min-w-56 rounded-md border shadow-md py-1"
          style={{ borderColor: "var(--border)", background: "var(--popover, var(--card))" }}
          data-testid="composer-pill-model-settings-popup"
        >
          <div
            role="radiogroup"
            aria-label="Reasoning"
            className="px-1 pt-1 pb-1.5"
          >
            <div
              className="px-2 pb-1 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--muted-foreground)" }}
            >
              Reasoning
            </div>
            {REASONING_ROWS.map((row) => {
              const isActive = row.label === reasoningLabel;
              return (
                <label
                  key={row.label}
                  className={clsx(
                    "w-full text-left px-2.5 py-1 flex items-center gap-2 rounded-sm hover:bg-[var(--accent)] cursor-pointer",
                    isActive && "bg-[var(--accent)]",
                  )}
                  data-testid={`composer-pill-model-settings-reasoning-${row.label}`}
                >
                  <input
                    type="radio"
                    name="model-settings-reasoning"
                    checked={isActive}
                    onChange={() => {
                      onPick(row.patch);
                      setOpen(false);
                    }}
                    className="size-3"
                  />
                  <span className="text-xs" style={{ color: "var(--foreground)" }}>
                    {row.label}
                  </span>
                </label>
              );
            })}
          </div>
          <div
            role="radiogroup"
            aria-label="Context window"
            className="px-1 pt-1 pb-1 border-t"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wide"
              style={{ color: "var(--muted-foreground)" }}
            >
              Context window
            </div>
            {CONTEXT_ROWS.map((row) => {
              const isActive = row.label === contextLabel;
              return (
                <label
                  key={row.label}
                  className={clsx(
                    "w-full text-left px-2.5 py-1 flex items-center gap-2 rounded-sm hover:bg-[var(--accent)] cursor-pointer",
                    isActive && "bg-[var(--accent)]",
                  )}
                  data-testid={`composer-pill-model-settings-context-${row.label}`}
                >
                  <input
                    type="radio"
                    name="model-settings-context"
                    checked={isActive}
                    onChange={() => {
                      onPick(row.patch);
                      setOpen(false);
                    }}
                    className="size-3"
                  />
                  <span className="text-xs" style={{ color: "var(--foreground)" }}>
                    {row.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

