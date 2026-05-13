/**
 * Unit tests for `aggregateSectionsByFile` — T-001.
 *
 * Asserts: same-path-later-wins dedupe, distinct paths preserved, and the
 * winning section's per-file counts are surfaced (NOT summed across the
 * replaced entries).
 */
import { describe, expect, test } from "vitest";

import { aggregateSectionsByFile } from "../src/lib/diff-aggregate";
import type { ApiDiffSection } from "../src/lib/api";

const earlyModifiedAlpha: ApiDiffSection = {
  kind: "per-turn",
  label: "turn 1",
  diff:
    "diff --git a/src/alpha.ts b/src/alpha.ts\n" +
    "index 1111111..2222222 100644\n" +
    "--- a/src/alpha.ts\n" +
    "+++ b/src/alpha.ts\n" +
    "@@ -1,1 +1,1 @@\n" +
    "-export const A = 1;\n" +
    "+export const A = 2;\n",
};

const laterModifiedAlpha: ApiDiffSection = {
  kind: "per-turn",
  label: "turn 2",
  diff:
    "diff --git a/src/alpha.ts b/src/alpha.ts\n" +
    "index 2222222..3333333 100644\n" +
    "--- a/src/alpha.ts\n" +
    "+++ b/src/alpha.ts\n" +
    "@@ -1,2 +1,2 @@\n" +
    "-export const A = 2;\n" +
    "+export const A = 3;\n" +
    " export const B = 0;\n",
};

const modifiedBeta: ApiDiffSection = {
  kind: "per-turn",
  label: "turn 2",
  diff:
    "diff --git a/src/beta.ts b/src/beta.ts\n" +
    "index aaaaaaa..bbbbbbb 100644\n" +
    "--- a/src/beta.ts\n" +
    "+++ b/src/beta.ts\n" +
    "@@ -1,1 +1,1 @@\n" +
    "-export const B = 0;\n" +
    "+export const B = 1;\n",
};

describe("aggregateSectionsByFile", () => {
  test("same path across sections → later section wins", () => {
    const files = aggregateSectionsByFile([earlyModifiedAlpha, laterModifiedAlpha]);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/alpha.ts");
    // Counts match the later section's tallies (1 add, 1 del), NOT the
    // sum of both sections (which would be 2/2).
    expect(files[0].added).toBe(1);
    expect(files[0].removed).toBe(1);
    // The later content (A = 3) is what survives.
    const lines = files[0].hunks.flat();
    expect(lines.some((l) => l.kind === "add" && l.text.includes("A = 3"))).toBe(true);
    expect(lines.some((l) => l.kind === "add" && l.text.includes("A = 2"))).toBe(false);
  });

  test("distinct paths across sections → both appear", () => {
    const files = aggregateSectionsByFile([earlyModifiedAlpha, modifiedBeta]);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["src/alpha.ts", "src/beta.ts"]);
  });

  test("later wins applies even within a single section block", () => {
    // Section A touches alpha + beta; section B touches alpha only with a
    // newer state. Result: beta (from A) + alpha (from B).
    const sectionA: ApiDiffSection = {
      kind: "per-turn",
      label: "turn 1",
      diff: earlyModifiedAlpha.diff + modifiedBeta.diff,
    };
    const sectionB: ApiDiffSection = {
      kind: "per-turn",
      label: "turn 2",
      diff: laterModifiedAlpha.diff,
    };
    const files = aggregateSectionsByFile([sectionA, sectionB]);
    expect(files.map((f) => f.path).sort()).toEqual(["src/alpha.ts", "src/beta.ts"]);
    const alpha = files.find((f) => f.path === "src/alpha.ts")!;
    expect(alpha.hunks.flat().some((l) => l.kind === "add" && l.text.includes("A = 3"))).toBe(true);
  });

  test("empty sections list → empty array", () => {
    expect(aggregateSectionsByFile([])).toEqual([]);
  });
});
