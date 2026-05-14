/**
 * Constants test for fabric-phase-map.ts.
 *
 * The phase mapping and empty-state copy strings are locked in
 * `spec.md` (## Constraints). This file imports the module and asserts
 * the exact values; any drift surfaces here.
 */
import { describe, expect, test } from "vitest";
import {
  PHASE_TO_FILE,
  PHASE_EMPTY_COPY,
  FABRIC_EMPTY_COPY,
} from "../src/components/fabric/fabric-phase-map";

describe("fabric-phase-map constants", () => {
  test("PHASE_TO_FILE maps every phase to its canonical artefact", () => {
    expect(PHASE_TO_FILE.spec).toBe("spec.md");
    expect(PHASE_TO_FILE.design).toBe("design.md");
    expect(PHASE_TO_FILE.plan).toBe("plan.md");
    expect(PHASE_TO_FILE.build).toBe("board.md");
    expect(PHASE_TO_FILE.review).toBe("review.md");
  });

  test("PHASE_EMPTY_COPY carries one locked sentence per phase", () => {
    expect(PHASE_EMPTY_COPY.spec).toBe("Spec not yet produced.");
    expect(PHASE_EMPTY_COPY.design).toBe("Design not yet produced.");
    expect(PHASE_EMPTY_COPY.plan).toBe("Plan not yet produced.");
    expect(PHASE_EMPTY_COPY.build).toBe("Build not yet produced.");
    expect(PHASE_EMPTY_COPY.review).toBe("Review not yet produced.");
  });

  test("FABRIC_EMPTY_COPY is the locked tree-empty sentence", () => {
    expect(FABRIC_EMPTY_COPY).toBe(
      "No artifacts yet — pipeline is still initializing.",
    );
  });
});
