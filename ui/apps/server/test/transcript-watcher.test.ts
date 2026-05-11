/**
 * Tests for the transcript-watcher. Covers:
 *   - extractTodosFromJsonlLine on a real-shape claude assistant turn
 *   - the supersede contract (later TodoWrite wins over earlier ones)
 *   - non-TodoWrite lines return null
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  TranscriptWatcher,
  extractTodosFromJsonlLine,
  extractTodosFromJsonlEntry,
} from "../src/transcript-watcher";

const TOOL_USE_LINE = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "TodoWrite",
        input: {
          todos: [
            { content: "Read files", activeForm: "Reading files", status: "in_progress" },
            { content: "Write code", activeForm: "Writing code", status: "pending" },
            { content: "Run tests", activeForm: "Running tests", status: "completed" },
          ],
        },
      },
    ],
  },
});

const NON_TODO_LINE = JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "text", text: "hello" }] },
});

describe("extractTodosFromJsonlLine", () => {
  test("extracts the todos and normalises status", () => {
    const tasks = extractTodosFromJsonlLine(TOOL_USE_LINE);
    expect(tasks).toEqual([
      { step: "Read files", activeForm: "Reading files", status: "inProgress" },
      { step: "Write code", activeForm: "Writing code", status: "pending" },
      { step: "Run tests", activeForm: "Running tests", status: "completed" },
    ]);
  });

  test("returns null for non-TodoWrite entries", () => {
    expect(extractTodosFromJsonlLine(NON_TODO_LINE)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(extractTodosFromJsonlLine("not-json{")).toBeNull();
  });

  test("ignores todos with empty content", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "", status: "pending" }, { content: "Real", status: "pending" }] },
          },
        ],
      },
    });
    const tasks = extractTodosFromJsonlLine(line);
    expect(tasks).toEqual([{ step: "Real", status: "pending" }]);
  });

  test("activeForm is omitted when missing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "Step", status: "pending" }] },
          },
        ],
      },
    });
    const tasks = extractTodosFromJsonlLine(line);
    expect(tasks).toEqual([{ step: "Step", status: "pending" }]);
  });
});

describe("extractTodosFromJsonlEntry", () => {
  test("when multiple TodoWrite tool_uses in one turn, last wins", () => {
    const entry = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "A", status: "pending" }] },
          },
          {
            type: "tool_use",
            name: "TodoWrite",
            input: { todos: [{ content: "B", status: "in_progress" }] },
          },
        ],
      },
    };
    expect(extractTodosFromJsonlEntry(entry)).toEqual([{ step: "B", status: "inProgress" }]);
  });
});

describe("TranscriptWatcher", () => {
  function tmp(): string {
    return mkdtempSync(path.join(tmpdir(), "nora-transcript-"));
  }

  test("emits the latest TodoWrite when one shows up", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, NON_TODO_LINE + "\n");

    const w = new TranscriptWatcher("sess", "/x", { filePath: file, debounceMs: 20 });
    const seen: any[] = [];
    w.on("tasks", (t) => seen.push(t));
    await w.start();
    expect(seen.length).toBe(0);

    appendFileSync(file, TOOL_USE_LINE + "\n");
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBe(1);
    expect(seen[0][0].step).toBe("Read files");
    w.stop();
    rmSync(dir, { recursive: true });
  });

  test("a newer TodoWrite supersedes the prior one (last-write-wins)", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, "");
    const w = new TranscriptWatcher("sess", "/x", { filePath: file, debounceMs: 20 });
    await w.start();

    const seen: any[] = [];
    w.on("tasks", (t) => seen.push(t));

    appendFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "TodoWrite",
              input: { todos: [{ content: "first", status: "pending" }] },
            },
          ],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 300));

    appendFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "TodoWrite",
              input: {
                todos: [
                  { content: "first", status: "completed" },
                  { content: "second", status: "in_progress" },
                ],
              },
            },
          ],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 300));

    expect(seen.length).toBe(2);
    // The latest task list, which the panel renders, is the second one.
    const latest = w.getLatestTasks();
    expect(latest).toEqual([
      { step: "first", status: "completed" },
      { step: "second", activeForm: undefined as any, status: "inProgress" } as any,
    ]);
    // Stricter check that ignores `activeForm: undefined` keys.
    expect(latest?.[0]?.status).toBe("completed");
    expect(latest?.[1]?.status).toBe("inProgress");
    expect(latest?.length).toBe(2);
    w.stop();
    rmSync(dir, { recursive: true });
  });

  test("resolves the JSONL path under ~/.claude/projects/<encoded-cwd>/<sid>.jsonl", () => {
    const w = new TranscriptWatcher("abc-123", "/Users/me/dev/x", { claudeHome: "/fake/.claude" });
    expect(w.filePath).toBe("/fake/.claude/projects/-Users-me-dev-x/abc-123.jsonl");
  });

  // Claude Code 2.1.x emits TaskCreate (one tool_use per task) and
  // TaskUpdate (per-status-change) instead of the older monolithic
  // TodoWrite. The watcher has to stitch the incremental updates into
  // the same Task[] shape the panel renders.
  test("TaskCreate + TaskUpdate produce an incremental task list", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, "");
    const w = new TranscriptWatcher("sess", "/x", { filePath: file, debounceMs: 20 });
    const seen: any[] = [];
    w.on("tasks", (t) => seen.push(t));
    await w.start();

    const createUse = (useId: string, subject: string, activeForm: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: useId,
              name: "TaskCreate",
              input: { subject, description: "x", activeForm },
            },
          ],
        },
      });
    const createResult = (useId: string, taskId: string, subject: string) =>
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { tool_use_id: useId, type: "tool_result", content: `Task #${taskId} created` },
          ],
        },
        toolUseResult: { task: { id: taskId, subject } },
      });
    const updateUse = (taskId: string, status: string) =>
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: `upd-${taskId}-${status}`,
              name: "TaskUpdate",
              input: { taskId, status },
            },
          ],
        },
      });

    appendFileSync(file, createUse("u1", "Refactor auth", "Refactoring auth") + "\n");
    appendFileSync(file, createResult("u1", "1", "Refactor auth") + "\n");
    appendFileSync(file, createUse("u2", "Fix flaky test", "Fixing flaky test") + "\n");
    appendFileSync(file, createResult("u2", "2", "Fix flaky test") + "\n");
    await new Promise((r) => setTimeout(r, 300));

    let latest = w.getLatestTasks();
    expect(latest).toEqual([
      { step: "Refactor auth", status: "pending", activeForm: "Refactoring auth" },
      { step: "Fix flaky test", status: "pending", activeForm: "Fixing flaky test" },
    ]);

    appendFileSync(file, updateUse("1", "in_progress") + "\n");
    await new Promise((r) => setTimeout(r, 300));
    latest = w.getLatestTasks();
    expect(latest?.[0]?.status).toBe("inProgress");
    expect(latest?.[1]?.status).toBe("pending");

    appendFileSync(file, updateUse("1", "completed") + "\n");
    appendFileSync(file, updateUse("2", "in_progress") + "\n");
    await new Promise((r) => setTimeout(r, 300));
    latest = w.getLatestTasks();
    expect(latest?.[0]?.status).toBe("completed");
    expect(latest?.[1]?.status).toBe("inProgress");

    // Each visible change should have produced exactly one emit.
    expect(seen.length).toBeGreaterThanOrEqual(4);
    w.stop();
    rmSync(dir, { recursive: true });
  });

  test("TaskUpdate for an unknown taskId is ignored", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, "");
    const w = new TranscriptWatcher("sess", "/x", { filePath: file, debounceMs: 20 });
    const seen: any[] = [];
    w.on("tasks", (t) => seen.push(t));
    await w.start();

    appendFileSync(
      file,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "stray",
              name: "TaskUpdate",
              input: { taskId: "999", status: "in_progress" },
            },
          ],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBe(0);
    expect(w.getLatestTasks()).toBeNull();
    w.stop();
    rmSync(dir, { recursive: true });
  });
});
