import type { PhaseId } from "./PhaseStepper";

export const PHASE_TO_FILE: Record<PhaseId, string> = {
  spec: "spec.md",
  design: "design.md",
  plan: "plan.md",
  build: "board.md",
  review: "review.md",
};

export const PHASE_EMPTY_COPY: Record<PhaseId, string> = {
  spec: "Spec not yet produced.",
  design: "Design not yet produced.",
  plan: "Plan not yet produced.",
  build: "Build not yet produced.",
  review: "Review not yet produced.",
};

export const FABRIC_EMPTY_COPY =
  "No artifacts yet — pipeline is still initializing.";
