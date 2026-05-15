import type { PhaseId } from "./PhaseStepper";
import type { FabricTreeEntry } from "./FabricFileTree";

export type PhaseGroupId = PhaseId | "misc";

/**
 * Path of the orchestrator state file. It is a project-level artifact
 * that is not owned by any single phase — the tree pins it at the top
 * instead of dropping it into a phase bucket.
 */
export const PIPELINE_PATH = "pipeline.md";

/**
 * Static file/folder patterns that belong to each phase.
 *
 * Patterns are evaluated in `PHASE_ORDER` order; the first match wins.
 * A string matches the path exactly. A RegExp tests the full relative path.
 *
 * Anything not matched (and not `PIPELINE_PATH`) lands in the `misc`
 * bucket so mapping gaps are visible in the UI rather than silently
 * absorbed.
 */
export const PHASE_PATTERNS: Record<PhaseId, ReadonlyArray<string | RegExp>> = {
  spec: [
    "seed.md",
    "idea.md",
    "repo-context.md",
    "spec.md",
    "decisions.md",
  ],
  design: [
    "design.md",
    /^mockup(\/|$)/,
  ],
  plan: [
    "plan.md",
    "task.md",
    "tests.md",
    /^tasks\/T-\d+\.md$/,
  ],
  build: [
    "board.md",
    /^tasks\/T-\d+\.done\.md$/,
    /^tasks\/T-\d+\.test-log\.txt$/,
    "test-report.md",
    "smoke-report.md",
    /^smoke-screenshots(\/|$)/,
    /^orchestrator(\/|$)/,
    "events.jsonl",
    "develop-log.md",
    "artifacts.json",
    /^\.locks?(\/|$)/,
  ],
  review: [
    "review.md",
    "quality-review.md",
    "feedback.md",
  ],
};

const PHASE_ORDER: PhaseId[] = ["spec", "design", "plan", "build", "review"];

export const PHASE_GROUP_ORDER: PhaseGroupId[] = [
  "spec",
  "design",
  "plan",
  "build",
  "review",
  "misc",
];

export const PHASE_GROUP_META: Record<
  PhaseGroupId,
  { num: string | null; label: string }
> = {
  spec: { num: "1", label: "Spec" },
  design: { num: "2", label: "Design" },
  plan: { num: "3", label: "Plan" },
  build: { num: "4", label: "Build" },
  review: { num: "5", label: "Review" },
  misc: { num: null, label: "Misc" },
};

/** Classify a single file path into a phase bucket. */
export function classifyPath(path: string): PhaseGroupId {
  for (const phase of PHASE_ORDER) {
    for (const matcher of PHASE_PATTERNS[phase]) {
      if (typeof matcher === "string") {
        if (matcher === path) return phase;
      } else if (matcher.test(path)) {
        return phase;
      }
    }
  }
  return "misc";
}

/**
 * Group fabric tree entries by phase.
 *
 * Files are classified individually via `classifyPath`. Directories are
 * included in every phase bucket that contains a descendant file, so
 * each per-phase subtree still renders its parent folder headers
 * (e.g. `tasks/` shows up in both plan and build with the appropriate
 * children).
 */
export function partitionByPhase(
  entries: ReadonlyArray<FabricTreeEntry>,
): Record<PhaseGroupId, FabricTreeEntry[]> {
  const buckets: Record<PhaseGroupId, FabricTreeEntry[]> = {
    spec: [],
    design: [],
    plan: [],
    build: [],
    review: [],
    misc: [],
  };

  const filePhaseByPath = new Map<string, PhaseGroupId>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    // pipeline.md is special-cased by the renderer (pinned at the top
    // outside any phase) — don't double-render it inside misc.
    if (entry.path === PIPELINE_PATH) continue;
    const phase = classifyPath(entry.path);
    filePhaseByPath.set(entry.path, phase);
    buckets[phase].push(entry);
  }

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const prefix = entry.path + "/";
    const phasesWithDescendants = new Set<PhaseGroupId>();
    for (const [filePath, phase] of filePhaseByPath) {
      if (filePath.startsWith(prefix)) phasesWithDescendants.add(phase);
    }
    for (const phase of phasesWithDescendants) {
      buckets[phase].push(entry);
    }
  }

  return buckets;
}
