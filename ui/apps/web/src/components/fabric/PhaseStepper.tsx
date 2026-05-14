import clsx from "clsx";
import { useRef, type KeyboardEvent } from "react";

export type PhaseId = "spec" | "design" | "plan" | "build" | "review";

export interface Phase {
  id: PhaseId;
  num: string;
  label: string;
  state: "pending" | "complete" | "active" | "todo";
}

const PHASES: Phase[] = [
  { id: "spec", num: "1", label: "Spec", state: "todo" },
  { id: "design", num: "2", label: "Design", state: "todo" },
  { id: "plan", num: "3", label: "Plan", state: "todo" },
  { id: "build", num: "4", label: "Build", state: "todo" },
  { id: "review", num: "5", label: "Review", state: "todo" },
];

const PHASE_ORDER: PhaseId[] = ["spec", "design", "plan", "build", "review"];

export interface PhaseStepperProps {
  selected: PhaseId;
  states?: Partial<Record<PhaseId, Phase["state"]>>;
  onSelect: (id: PhaseId) => void;
}

export function PhaseStepper({ selected, states, onSelect }: PhaseStepperProps) {
  const buttonRefs = useRef<Record<PhaseId, HTMLButtonElement | null>>({
    spec: null,
    design: null,
    plan: null,
    build: null,
    review: null,
  });
  const phases = PHASES.map((phase) => ({
    ...phase,
    state: states?.[phase.id] ?? (phase.id === selected ? "active" : "todo"),
  }));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: PhaseId) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const index = PHASE_ORDER.indexOf(id);
    const nextIndex =
      event.key === "ArrowRight" ? index + 1 : index - 1;
    const nextId = PHASE_ORDER[nextIndex];
    if (!nextId) return;
    event.preventDefault();
    onSelect(nextId);
    buttonRefs.current[nextId]?.focus();
  };

  return (
    <ol
      role="tablist"
      aria-label="Fabric phases"
      className="px-5 pb-3 flex items-center gap-0 list-none"
    >
      {phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        const isActive = phase.state === "active";
        const isPending = phase.state === "pending";
        const isComplete = phase.state === "complete";
        const isSelected = phase.id === selected;
        const opacity =
          isActive || isPending || isComplete
            ? 1
            : index > phases.findIndex((entry) => entry.id === selected)
              ? 0.3
              : 0.5;
        return (
          <li key={phase.id} className="flex items-center">
            <button
              type="button"
              role="tab"
              ref={(node) => {
                buttonRefs.current[phase.id] = node;
              }}
              aria-selected={selected === phase.id}
              aria-current={selected === phase.id ? "step" : undefined}
              tabIndex={selected === phase.id ? 0 : -1}
              onClick={() => onSelect(phase.id)}
              onKeyDown={(event) => onKeyDown(event, phase.id)}
              className={clsx(
                "flex items-center gap-1.5 px-2 py-1 rounded-full",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--info)]",
              )}
              style={{
                background: isPending
                  ? "rgba(245,158,11,0.12)"
                  : isComplete
                    ? "rgba(16,185,129,0.12)"
                    : isActive
                      ? "rgba(59,130,246,0.12)"
                      : "transparent",
                opacity,
              }}
            >
              {isPending ? (
                <span
                  className="size-1.5 rounded-full awaiting-pulse"
                  style={{ background: "var(--warning)" }}
                />
              ) : isComplete ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  className="size-3"
                  style={{ color: "var(--success)" }}
                >
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : isActive ? (
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: "var(--info)" }}
                />
              ) : (
                <span
                  className="size-3 rounded-full grid place-items-center text-[8px] font-bold"
                  style={{
                    borderWidth: 1,
                    borderStyle: "solid",
                    borderColor: "var(--border)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {phase.num}
                </span>
              )}
              <span
                className={clsx(
                  "text-[11px]",
                  (isPending || isActive || isComplete) && "font-medium",
                )}
                style={{
                  color: isPending
                    ? "var(--warning-foreground)"
                    : isComplete
                      ? "var(--success-foreground)"
                      : isActive
                        ? "var(--info-foreground)"
                        : "var(--muted-foreground)",
                }}
              >
                P{phase.num} {phase.label}
              </span>
              {isPending && (
                <span
                  className="text-[10px] font-mono"
                  style={{ color: "var(--warning-foreground)" }}
                >
                  pending
                </span>
              )}
              {isActive && (
                <span
                  className="text-[10px] font-mono"
                  style={{ color: "var(--info-foreground)" }}
                >
                  active
                </span>
              )}
            </button>
            {!isLast && (
              <div
                aria-hidden
                className="h-px w-6"
                style={{ background: "var(--border)" }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
