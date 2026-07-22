/**
 * ChatSettingsModal — the per-chat settings surface, opened from the
 * gear icon anchored to the top-right of the chat window. Collects the
 * four settings that used to live as composer-footer pills into one
 * clean, sectioned dialog:
 *
 *   1. Model            → `{ model }`            (dynamic list from the server)
 *   2. Reasoning        → `{ effort, thinking }`
 *   3. Context window   → `{ contextWindow }`
 *   4. Mode (Build/Plan)→ `permissionMode` ('plan' ↔ last non-plan)
 *   5. Access level     → `permissionMode` (default / acceptEdits / bypassPermissions)
 *
 * Model / reasoning / context emit partial {@link WireModelSettings}
 * patches through {@link onModelSettingsSet}; Mode + Access dispatch
 * through {@link onPermissionModeChange} — the exact same wire paths the
 * old pills used, so nothing downstream changed.
 *
 * The component is ALWAYS mounted (visibility is gated on `open`) so the
 * `lastNonPlanMode` ref survives close/reopen — the Build/Plan toggle
 * restores the user's prior access level when leaving Plan, matching the
 * old BuildPlanTogglePill behaviour.
 */
import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import type { ModelOption } from "../../lib/api";
import type { PermissionMode, WireModelSettings } from "../../lib/chat-types";
import {
  ClipboardListIcon,
  HammerIcon,
  LockOpenIcon,
  PenLineIcon,
  ShieldIcon,
  type ModeIconProps,
} from "./composer-pill-icons";
import { OptionCard, Section } from "./settings-ui";

export interface ChatSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Server-resolved selectable models (falls back to a built-in list). */
  models: ModelOption[] | null;
  /** Current per-chat model settings (NULL ⇒ Loom defaults apply). */
  modelSettings: WireModelSettings | null;
  onModelSettingsSet: (patch: Partial<WireModelSettings>) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

type ReasoningLabel = "Low" | "Medium" | "High" | "Extra High" | "Max" | "Ultrathink";
type ContextLabel = "200k" | "1M";
type AccessValue = Exclude<PermissionMode, "plan">;

/** Single source of truth for the Ultrathink reasoning budget. */
const ULTRATHINK_BUDGET_TOKENS = 32000;

/** Built-in fallback so the modal is never empty if the fetch is slow. */
const FALLBACK_MODELS: ReadonlyArray<ModelOption> = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

const REASONING_ROWS: ReadonlyArray<{ label: ReasoningLabel; patch: Partial<WireModelSettings> }> = [
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

const CONTEXT_ROWS: ReadonlyArray<{ label: ContextLabel; patch: Partial<WireModelSettings> }> = [
  { label: "200k", patch: { contextWindow: "200k" } },
  { label: "1M", patch: { contextWindow: "1m" } },
];

const ACCESS_ROWS: ReadonlyArray<{
  value: AccessValue;
  label: string;
  description: string;
  Icon: (props: ModeIconProps) => JSX.Element;
}> = [
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

const DEFAULT_REASONING: ReasoningLabel = "Extra High";
const DEFAULT_CONTEXT: ContextLabel = "200k";

function deriveReasoningLabel(value: WireModelSettings | null): ReasoningLabel {
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

function deriveContextLabel(value: WireModelSettings | null): ContextLabel {
  if (value?.contextWindow === "1m") return "1M";
  return DEFAULT_CONTEXT;
}

export function ChatSettingsModal({
  open,
  onClose,
  models,
  modelSettings,
  onModelSettingsSet,
  permissionMode,
  onPermissionModeChange,
}: ChatSettingsModalProps) {
  // Survives close/reopen (component stays mounted) so "Build" restores
  // the access level the user was on before switching to Plan.
  const lastNonPlanModeRef = useRef<PermissionMode>(
    permissionMode === "plan" ? "default" : permissionMode,
  );
  useEffect(() => {
    if (permissionMode !== "plan" && permissionMode !== lastNonPlanModeRef.current) {
      lastNonPlanModeRef.current = permissionMode;
    }
  }, [permissionMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modelList = models && models.length > 0 ? models : FALLBACK_MODELS;
  const reasoningLabel = deriveReasoningLabel(modelSettings);
  const contextLabel = deriveContextLabel(modelSettings);
  const isPlan = permissionMode === "plan";
  const activeModel = modelSettings?.model ?? null;

  return (
    <div
      className="fixed inset-0 z-50 backdrop-blur-[2px] grid place-items-center px-4"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="chat-settings-modal"
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-xl border overflow-hidden"
        style={{ borderColor: "var(--border)", background: "var(--popover, var(--card))" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Chat settings"
      >
        <div
          className="px-5 py-4 border-b flex items-center gap-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <div
            className="size-8 rounded-lg grid place-items-center"
            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 014 17.93l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9.9a1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 016.07 4l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 009.1 2.91V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06A2 2 0 0119.93 7l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.27.66.92 1.09 1.65 1.09H21a2 2 0 010 4h-.09c-.73 0-1.38.43-1.65 1.09z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
              Chat settings
            </h2>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              Model, reasoning, context window & permissions for this chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Model */}
          <Section title="Model">
            <div className="grid grid-cols-2 gap-1.5">
              <OptionChip
                active={activeModel === null}
                onClick={() => onModelSettingsSet({ model: null })}
                label="Default"
              />
              {modelList.map((m) => (
                <OptionChip
                  key={m.id}
                  active={activeModel === m.id}
                  onClick={() => onModelSettingsSet({ model: m.id })}
                  label={m.label}
                  testId={`chat-settings-model-${m.id}`}
                />
              ))}
            </div>
          </Section>

          {/* Reasoning */}
          <Section title="Reasoning">
            <div className="grid grid-cols-3 gap-1.5">
              {REASONING_ROWS.map((row) => (
                <OptionChip
                  key={row.label}
                  active={row.label === reasoningLabel}
                  onClick={() => onModelSettingsSet(row.patch)}
                  label={row.label}
                  testId={`chat-settings-reasoning-${row.label}`}
                />
              ))}
            </div>
          </Section>

          {/* Context window */}
          <Section title="Context window">
            <div className="grid grid-cols-2 gap-1.5">
              {CONTEXT_ROWS.map((row) => (
                <OptionChip
                  key={row.label}
                  active={row.label === contextLabel}
                  onClick={() => onModelSettingsSet(row.patch)}
                  label={row.label}
                  testId={`chat-settings-context-${row.label}`}
                />
              ))}
            </div>
          </Section>

          {/* Mode: Build / Plan */}
          <Section title="Mode">
            <div className="grid grid-cols-2 gap-1.5">
              <ModeCard
                active={!isPlan}
                onClick={() => {
                  if (isPlan) onPermissionModeChange(lastNonPlanModeRef.current);
                }}
                icon={<HammerIcon className="size-4" />}
                label="Build"
                description="Claude executes changes."
                testId="chat-settings-mode-build"
              />
              <ModeCard
                active={isPlan}
                onClick={() => onPermissionModeChange("plan")}
                icon={<ClipboardListIcon className="size-4" />}
                label="Plan"
                description="Claude proposes without changes."
                testId="chat-settings-mode-plan"
              />
            </div>
          </Section>

          {/* Access level */}
          <Section title="Access">
            <div className="space-y-1.5">
              {ACCESS_ROWS.map((row) => {
                const Icon = row.Icon;
                const isActive = !isPlan && permissionMode === row.value;
                return (
                  <OptionCard
                    key={row.value}
                    active={isActive}
                    onClick={() => onPermissionModeChange(row.value)}
                    icon={<Icon className="size-4" />}
                    label={row.label}
                    description={row.description}
                    testId={`chat-settings-access-${row.value}`}
                  />
                );
              })}
              {isPlan && (
                <p className="text-[10px] pt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  Picking an access level switches out of Plan mode.
                </p>
              )}
            </div>
          </Section>
        </div>

        <div
          className="px-5 py-3 border-t flex items-center justify-end"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm"
            style={{ background: "var(--primary)" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionChip({
  active,
  onClick,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "h-8 px-2.5 rounded-lg border text-xs font-medium",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
      style={{
        borderColor: active ? "var(--primary)" : "var(--border)",
        color: "var(--foreground)",
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  label,
  description,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  description: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "text-left px-3 py-2 rounded-lg border flex flex-col gap-0.5",
        active ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]",
      )}
      style={{ borderColor: active ? "var(--primary)" : "var(--border)" }}
      data-testid={testId}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--foreground)" }}>
        {icon}
        {label}
      </span>
      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
        {description}
      </span>
    </button>
  );
}
