/**
 * Parser coverage for the four bullet shapes and the heading-alias map
 * used by board.md files across the project. Locks the lane order and
 * the `(none)` skip behaviour so future board variants don't drift.
 */
import { describe, expect, test } from "vitest";
import { parseBoardMarkdown } from "../src/components/fabric/board-parser";

describe("parseBoardMarkdown", () => {
  test("returns four lanes in fixed order", () => {
    const columns = parseBoardMarkdown("");
    expect(columns.map((c) => c.id)).toEqual([
      "backlog",
      "in-progress",
      "review",
      "done",
    ]);
  });

  test("strips YAML frontmatter before scanning", () => {
    const source = [
      "---",
      "project: x",
      "phase: build",
      "---",
      "",
      "## Done",
      "",
      "- T-001 — Title",
    ].join("\n");
    const done = lane(parseBoardMarkdown(source), "done");
    expect(done.cards).toHaveLength(1);
    expect(done.cards[0]).toMatchObject({ id: "T-001", title: "Title", done: true });
  });

  test("recognises Pending as backlog and In progress as in-progress", () => {
    const source = [
      "## Pending",
      "- T-001 — A",
      "## In progress",
      "- T-002 — B",
    ].join("\n");
    const columns = parseBoardMarkdown(source);
    expect(lane(columns, "backlog").cards[0].id).toBe("T-001");
    expect(lane(columns, "in-progress").cards[0].id).toBe("T-002");
  });

  test("(none) markers are skipped", () => {
    const source = "## Backlog\n- (none)\n";
    expect(lane(parseBoardMarkdown(source), "backlog").cards).toEqual([]);
  });

  test("linked id form: [T-011](tasks/T-011.md) [HITL] — Title", () => {
    const source =
      "## Review\n- [T-011](tasks/T-011.md) [HITL] — Title (US-008, AFK) [commit 79a6185]\n";
    const card = lane(parseBoardMarkdown(source), "review").cards[0];
    expect(card).toMatchObject({ id: "T-011", title: "Title" });
    expect(card.tags).toContain("HITL");
    expect(card.tags ?? []).not.toContain("commit 79a6185");
  });

  test("bold id form with sub-bullets ignored", () => {
    const source = [
      "## Done",
      "- **T-001** — PhaseStepper — new PhaseId union",
      "  - touches: file.ts",
      "  - status: green",
    ].join("\n");
    const card = lane(parseBoardMarkdown(source), "done").cards[0];
    expect(card.id).toBe("T-001");
    expect(card.title).toBe("PhaseStepper — new PhaseId union");
  });

  test("tag-prefixed id: [HITL] T-008 Title (no dash)", () => {
    const source = "## Done\n- [HITL] T-008 Manual verification of restart\n";
    const card = lane(parseBoardMarkdown(source), "done").cards[0];
    expect(card.id).toBe("T-008");
    expect(card.title).toBe("Manual verification of restart");
    expect(card.tags).toContain("HITL");
  });

  test("suffixed ids like T-006-followup are kept whole", () => {
    const source = "## Done\n- T-006-followup — SWIFT follow-up\n";
    const card = lane(parseBoardMarkdown(source), "done").cards[0];
    expect(card.id).toBe("T-006-followup");
  });

  test("done lane marks cards done=true", () => {
    const source = "## Done\n- T-001 — A\n## Review\n- T-002 — B\n";
    const columns = parseBoardMarkdown(source);
    expect(lane(columns, "done").cards[0].done).toBe(true);
    expect(lane(columns, "review").cards[0].done).toBeUndefined();
  });

  test("## Notes section is ignored", () => {
    const source = [
      "## Done",
      "- T-001 — A",
      "## Notes",
      "- not a task",
    ].join("\n");
    const columns = parseBoardMarkdown(source);
    expect(lane(columns, "done").cards).toHaveLength(1);
  });
});

function lane(
  columns: ReturnType<typeof parseBoardMarkdown>,
  id: "backlog" | "in-progress" | "review" | "done",
) {
  const match = columns.find((c) => c.id === id);
  if (!match) throw new Error(`lane ${id} missing`);
  return match;
}
