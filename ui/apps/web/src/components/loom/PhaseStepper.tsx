import clsx from "clsx";

export type PhaseId = "idea" | "design" | "plan" | "build" | "review";

export interface Phase {
  id: PhaseId;
  num: string;
  label: string;
  state: "pending" | "complete" | "active" | "todo";
}

const PHASES: Phase[] = [
  { id: "idea",   num: "1", label: "Idea",   state: "todo" },
  { id: "design", num: "2", label: "Design", state: "todo" },
  { id: "plan",   num: "3", label: "Plan",   state: "todo" },
  { id: "build",  num: "4", label: "Build",  state: "todo" },
  { id: "review", num: "5", label: "Review", state: "todo" },
];

export interface PhaseStepperProps {
  current: PhaseId;
  /** Override states by id, e.g. { idea: "complete", design: "complete", plan: "active" } */
  states?: Partial<Record<PhaseId, Phase["state"]>>;
}

export function PhaseStepper({ current, states }: PhaseStepperProps) {
  const phases = PHASES.map((p) => ({ ...p, state: states?.[p.id] ?? (p.id === current ? "active" : "todo") }));
  return (
    <div className="px-5 pb-3 flex items-center gap-0">
      {phases.map((p, i) => {
        const isLast = i === phases.length - 1;
        const isActive = p.state === "active";
        const isPending = p.state === "pending";
        const isComplete = p.state === "complete";
        const opacity = isActive || isPending || isComplete ? 1 : i > phases.findIndex((x) => x.id === current) ? 0.3 : 0.5;
        return (
          <div key={p.id} className="flex items-center">
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-full"
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
                <span className="size-1.5 rounded-full awaiting-pulse" style={{ background: "var(--warning)" }} />
              ) : isComplete ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="size-3" style={{ color: "var(--success)" }}>
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : isActive ? (
                <span className="size-1.5 rounded-full" style={{ background: "var(--info)" }} />
              ) : (
                <span className="size-3 rounded-full grid place-items-center text-[8px] font-bold" style={{ borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                  {p.num}
                </span>
              )}
              <span
                className={clsx("text-[11px]", (isPending || isActive || isComplete) && "font-medium")}
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
                P{p.num} {p.label}
              </span>
              {isPending && (
                <span className="text-[10px] font-mono" style={{ color: "var(--warning-foreground)" }}>
                  pending
                </span>
              )}
              {isActive && (
                <span className="text-[10px] font-mono" style={{ color: "var(--info-foreground)" }}>
                  active
                </span>
              )}
            </div>
            {!isLast && <div className="h-px w-6" style={{ background: "var(--border)" }} />}
          </div>
        );
      })}
    </div>
  );
}
