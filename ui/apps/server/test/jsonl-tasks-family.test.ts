/**
 * T-004 — Regression test pinning the schema + materializer wire for the
 * `TaskCreate` / `TaskUpdate` / `TaskList` family (US-002).
 *
 * Drives each T-003 fixture through `translate` + `materializer.ingest` and
 * asserts the emitted `tasks-update` frame bodies match the expected wire
 * shape. The "failing-silently" safety net: if a future schema regression
 * sends `TaskCreate` back to the generic `tool_use` branch, the AC4
 * negative assertion fails with a named-frame message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranslatorCtx } from "../src/process-manager/jsonl/translator.ts";
import { translateMany } from "./helpers/translate.ts";
import {
  createMaterializer,
  type Materializer,
} from "../src/process-manager/jsonl/materializer.ts";
import type { ClaudeEvent } from "../src/process-manager/jsonl/schema.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";
import type { Task } from "../src/chat-protocol/messages.ts";

const FIXTURE_DIR = join(__dirname, "fixtures", "jsonl");

function loadFixture(name: string): ClaudeEvent[] {
  const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const ctx: TranslatorCtx = { chatId: `chat-${name}`, sessionId: `sess-${name}` };
  return translateMany(lines, ctx);
}

function runThroughMaterializer(
  events: ClaudeEvent[],
  chatId: string,
): {
  materializer: Materializer;
  frames: ServerFrame[];
  tasksFrames: Array<Extract<ServerFrame, { kind: "tasks-update" }>>;
} {
  const m = createMaterializer({ chatId });
  const frames: ServerFrame[] = [];
  for (const e of events) frames.push(...m.ingest(e));
  const tasksFrames = frames.filter(
    (f): f is Extract<ServerFrame, { kind: "tasks-update" }> =>
      f.kind === "tasks-update",
  );
  return { materializer: m, frames, tasksFrames };
}

describe("regression: 12-task-create.jsonl", () => {
  it("AC2: emits >=1 tasks-update frame with the expected Task[]", () => {
    const events = loadFixture("12-task-create.jsonl");
    const { tasksFrames } = runThroughMaterializer(events, "chat-12");
    expect(tasksFrames.length).toBeGreaterThanOrEqual(1);
    // The TaskCreate-only fixture creates 3 tasks; the final tasks-update
    // frame is the cumulative snapshot.
    const final = tasksFrames[tasksFrames.length - 1]!.body.tasks;
    expect(final).toEqual([
      { step: "task 1", status: "pending" },
      { step: "task 2", status: "pending" },
      { step: "task 3", status: "pending" },
    ]);
  });
});

describe("regression: 13-task-create-update.jsonl", () => {
  it("AC2/AC3/AC4: TaskCreate appends, TaskUpdate mutates, in_progress normalises to inProgress", () => {
    const events = loadFixture("13-task-create-update.jsonl");
    const { tasksFrames } = runThroughMaterializer(events, "chat-13");
    // 4 creates + 2 updates = 6 tasks-update frames.
    expect(tasksFrames.length).toBeGreaterThanOrEqual(2);
    const final = tasksFrames[tasksFrames.length - 1]!.body.tasks;
    // Last frame in the fixture is TaskUpdate(taskId="1", status="completed"),
    // so the first task ends `completed`; the remaining three stay `pending`.
    expect(final).toHaveLength(4);
    expect(final[0]?.status).toBe("completed");
    for (const t of final) {
      // Wire-form status — no "in_progress" leaks through.
      expect(["pending", "inProgress", "completed"]).toContain(t.status);
    }
    // The middle frames should have witnessed status="inProgress" (AC4):
    // the second-to-last frame is TaskUpdate(1, in_progress).
    const interim = tasksFrames[tasksFrames.length - 2]!.body.tasks;
    expect(interim[0]?.status).toBe("inProgress");
  });
});

describe("regression: 14-task-list.jsonl", () => {
  it("AC1: emits a tasks-update frame echoing the (empty) snapshot without mutating", () => {
    const events = loadFixture("14-task-list.jsonl");
    const { materializer, tasksFrames } = runThroughMaterializer(events, "chat-14");
    // The fixture contains one TaskList action with no prior TaskCreate, so
    // the emitted frame is a snapshot of the (empty) tasks list.
    expect(tasksFrames.length).toBe(1);
    expect(tasksFrames[0]!.body.tasks).toEqual([]);
    // The materializer's tasks state is also empty (list does not mutate).
    expect(materializer.snapshot().tasks).toEqual([]);
  });
});

describe("regression: failing-silently shape", () => {
  it("AC4: a fixture containing TaskCreate MUST produce a tasks-update frame", () => {
    const events = loadFixture("12-task-create.jsonl");
    const { tasksFrames } = runThroughMaterializer(events, "chat-12-aux");
    expect(
      tasksFrames.length,
      `expected at least one frame of kind "tasks-update" but materializer emitted none — ` +
        `this means TaskCreate fell through to the generic tool_use branch (regression of the original bug)`,
    ).toBeGreaterThan(0);
  });

  it("AC5: every tasks-update frame body matches the Task wire interface (step, status, activeForm?)", () => {
    const allEvents = [
      ...loadFixture("12-task-create.jsonl"),
      ...loadFixture("13-task-create-update.jsonl"),
      ...loadFixture("14-task-list.jsonl"),
    ];
    const { tasksFrames } = runThroughMaterializer(allEvents, "chat-all");
    for (const f of tasksFrames) {
      for (const t of f.body.tasks as Task[]) {
        const keys = Object.keys(t).sort();
        for (const k of keys) {
          expect(["step", "status", "activeForm"]).toContain(k);
        }
        expect(typeof t.step).toBe("string");
        expect(["pending", "inProgress", "completed"]).toContain(t.status);
      }
    }
  });
});
