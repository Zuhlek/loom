/**
 * Unit tests for `buildSectionedFiles` — the per-repo flattening that
 * backs the total-diff render. Replaces the old `aggregateSectionsByFile`
 * unit test (the whole/per-turn aggregation it covered no longer exists).
 *
 * Contract:
 *   - empty input → []
 *   - a single non-empty section renders flat (no repo label)
 *   - multiple sections prefix each section's FIRST file with a `meta`
 *     line carrying the repo label; the root repo's empty label → "(root)"
 *   - empty-diff sections are dropped before counting (so one survivor
 *     still renders flat)
 */
import { describe, expect, test } from "vitest";

import { buildSectionedFiles } from "../src/components/diff/DiffPanelContainer";
import type { ApiDiffSection } from "../src/lib/api";

const rootDiff =
  "diff --git a/a.txt b/a.txt\n" +
  "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+A\n" +
  "diff --git a/b.txt b/b.txt\n" +
  "--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-b\n+B\n";

const subDiff =
  "diff --git a/c.txt b/c.txt\n" +
  "--- a/c.txt\n+++ b/c.txt\n@@ -1 +1 @@\n-c\n+C\n";

const root: ApiDiffSection = { kind: "whole", label: "", diff: rootDiff };
const sub: ApiDiffSection = { kind: "whole", label: "packages/sub", diff: subDiff };

describe("buildSectionedFiles", () => {
  test("empty input → []", () => {
    expect(buildSectionedFiles([])).toEqual([]);
  });

  test("a single section renders flat with no repo label", () => {
    const files = buildSectionedFiles([root]);
    expect(files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
    // First line of the first file is real diff content, not a label.
    expect(files[0]!.hunks[0]![0]!.kind).not.toBe("meta");
  });

  test("multiple sections prefix each section's first file with a label", () => {
    const files = buildSectionedFiles([root, sub]);
    expect(files.map((f) => f.path)).toEqual(["a.txt", "b.txt", "c.txt"]);

    // Root section's first file → "(root)" label.
    expect(files[0]!.hunks[0]![0]).toEqual({ kind: "meta", text: "(root)" });
    // Second file of the root section is NOT relabelled.
    expect(files[1]!.hunks[0]![0]!.kind).not.toBe("meta");
    // Nested section's first file → its relative path label.
    expect(files[2]!.hunks[0]![0]).toEqual({ kind: "meta", text: "packages/sub" });
  });

  test("empty-diff sections are dropped, leaving the survivor flat", () => {
    const empty: ApiDiffSection = { kind: "whole", label: "", diff: "" };
    const files = buildSectionedFiles([empty, sub]);
    expect(files.map((f) => f.path)).toEqual(["c.txt"]);
    // Only one real section survived → no label prefix.
    expect(files[0]!.hunks[0]![0]!.kind).not.toBe("meta");
  });
});
