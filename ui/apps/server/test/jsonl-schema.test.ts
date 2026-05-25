import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  FIELDS_V1,
  parseLine,
  parserFor,
  type ClaudeEvent,
  type ParseCtx,
} from "../src/process-manager/jsonl/schema.ts";

const ctx: ParseCtx = { chatId: "c-1", sessionId: "s-1" };

describe("jsonl/schema", () => {
  it("CURRENT_SCHEMA_VERSION is the v1 literal", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("v1");
  });

  it("FIELDS_V1 contains the documented field-name string literals", () => {
    expect(FIELDS_V1.TYPE).toBe("type");
    expect(FIELDS_V1.UUID).toBe("uuid");
    expect(FIELDS_V1.SESSION_ID).toBe("sessionId");
    expect(FIELDS_V1.TIMESTAMP).toBe("timestamp");
    expect(FIELDS_V1.MESSAGE).toBe("message");
    expect(FIELDS_V1.CONTENT).toBe("content");
    expect(FIELDS_V1.ROLE).toBe("role");
    expect(FIELDS_V1.TOOL_USE_ID).toBe("tool_use_id");
    expect(FIELDS_V1.TOOL_NAME).toBe("name");
    expect(FIELDS_V1.INPUT).toBe("input");
  });

  it("stamps every returned event with the current schema version", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-1",
      timestamp: "2026-05-23T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("produces a kind=unknown event for unrecognised type values rather than throwing", () => {
    const line = JSON.stringify({
      type: "some-future-event",
      uuid: "u-X",
      timestamp: "2026-05-23T00:00:00.000Z",
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("unknown");
    if (evt.kind === "unknown") {
      expect(evt.rawKind).toBe("some-future-event");
    }
  });

  it("parserFor('v1') returns a stable-shape function and is deterministic", () => {
    const fn1 = parserFor("v1");
    const fn2 = parserFor("v1");
    expect(typeof fn1).toBe("function");
    expect(typeof fn2).toBe("function");
    const raw = {
      type: "user",
      uuid: "u-2",
      timestamp: "2026-05-23T01:00:00.000Z",
      message: { role: "user", content: "deterministic" },
    };
    const a = fn1(raw, ctx);
    const b = fn2(raw, ctx);
    expect(a).toEqual(b);
  });

  it("text event: user role with string content", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-3",
      timestamp: "2026-05-23T00:00:00.000Z",
      message: { role: "user", content: "hi there" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") {
      expect(evt.role).toBe("user");
      expect(evt.text).toBe("hi there");
      expect(evt.id).toBe("u-3");
      expect(evt.chatId).toBe("c-1");
      expect(evt.sessionId).toBe("s-1");
      expect(evt.tsIso).toBe("2026-05-23T00:00:00.000Z");
    }
  });

  it("text event: assistant role with content-block array", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "u-4",
      timestamp: "2026-05-23T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello world" }],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") {
      expect(evt.role).toBe("assistant");
      expect(evt.text).toBe("hello world");
    }
  });

  it("tool_use event: assistant content with tool_use block", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "u-5",
      timestamp: "2026-05-23T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu-1",
            name: "Read",
            input: { file_path: "/etc/hosts" },
          },
        ],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("tool_use");
    if (evt.kind === "tool_use") {
      expect(evt.toolName).toBe("Read");
      expect(evt.toolUseId).toBe("tu-1");
      expect(evt.input).toEqual({ file_path: "/etc/hosts" });
    }
  });

  it("tool_result event: user content with tool_result block (ok=true on is_error=false)", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-6",
      timestamp: "2026-05-23T00:00:03.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1",
            content: "file contents here",
            is_error: false,
          },
        ],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("tool_result");
    if (evt.kind === "tool_result") {
      expect(evt.toolUseId).toBe("tu-1");
      expect(evt.ok).toBe(true);
      expect(evt.output).toBe("file contents here");
    }
  });

  it("tool_result event: ok=false when is_error=true", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-6e",
      timestamp: "2026-05-23T00:00:03.500Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1e",
            content: "boom",
            is_error: true,
          },
        ],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("tool_result");
    if (evt.kind === "tool_result") {
      expect(evt.ok).toBe(false);
    }
  });

  it("tool_result event: ok=true when is_error is absent", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-6n",
      timestamp: "2026-05-23T00:00:03.750Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu-1n",
            content: "ok",
          },
        ],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("tool_result");
    if (evt.kind === "tool_result") {
      expect(evt.ok).toBe(true);
    }
  });

  describe("schema — task_update family", () => {
    function taskToolLine(uuid: string, name: string, input: unknown): string {
      return JSON.stringify({
        type: "assistant",
        uuid,
        timestamp: "2026-05-23T00:00:04.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `tu-${uuid}`,
              name,
              input,
            },
          ],
        },
      });
    }

    it("AC1: TaskCreate tool_use is hoisted to kind=task_update, action=create", () => {
      const evt = parseLine(
        taskToolLine("u-tc", "TaskCreate", { subject: "S", activeForm: "A" }),
        ctx,
      );
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.action).toBe("create");
        expect(evt.subject).toBe("S");
        expect(evt.activeForm).toBe("A");
      }
    });

    it("AC1: TaskUpdate tool_use is hoisted to kind=task_update, action=update", () => {
      const evt = parseLine(
        taskToolLine("u-tu", "TaskUpdate", { taskId: "1", status: "in_progress" }),
        ctx,
      );
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.action).toBe("update");
        expect(evt.taskId).toBe("1");
      }
    });

    it("AC1: TaskList tool_use is hoisted to kind=task_update, action=list", () => {
      const evt = parseLine(taskToolLine("u-tl", "TaskList", {}), ctx);
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.action).toBe("list");
        expect(evt.taskId).toBeUndefined();
      }
    });

    it("AC4: TaskUpdate.input.status \"in_progress\" normalises to \"inProgress\" at the schema seam", () => {
      const evt = parseLine(
        taskToolLine("u-tu-ip", "TaskUpdate", { taskId: "1", status: "in_progress" }),
        ctx,
      );
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.status).toBe("inProgress");
      }
    });

    it("AC4: TaskUpdate with already-camelCase status passes through unchanged", () => {
      const evt = parseLine(
        taskToolLine("u-tu-camel", "TaskUpdate", { taskId: "1", status: "inProgress" }),
        ctx,
      );
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.status).toBe("inProgress");
      }
    });

    it("schema falls through to generic tool_use for unknown status (e.g. \"failed\")", () => {
      const evt = parseLine(
        taskToolLine("u-tu-failed", "TaskUpdate", { taskId: "1", status: "failed" }),
        ctx,
      );
      expect(evt.kind).toBe("tool_use");
      if (evt.kind === "tool_use") {
        expect(evt.toolName).toBe("TaskUpdate");
      }
    });

    it("TaskCreate without subject falls back to description", () => {
      const evt = parseLine(
        taskToolLine("u-tc-desc", "TaskCreate", { description: "D", activeForm: "A" }),
        ctx,
      );
      expect(evt.kind).toBe("task_update");
      if (evt.kind === "task_update") {
        expect(evt.subject).toBe("D");
      }
    });
  });

  it("session_meta event for type=summary records session lifecycle", () => {
    const line = JSON.stringify({
      type: "summary",
      uuid: "u-8",
      timestamp: "2026-05-23T00:00:05.000Z",
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("session_meta");
  });

  it("throws on invalid JSON rather than returning a garbage event", () => {
    expect(() => parseLine("{not json", ctx)).toThrow();
  });

  it("synthesises an id when uuid is absent (defensive — keeps dedupe key stable)", () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2026-05-23T00:00:06.000Z",
      message: { role: "user", content: "noid" },
    });
    const evt = parseLine(line, ctx);
    expect(typeof evt.id).toBe("string");
    expect(evt.id.length).toBeGreaterThan(0);
  });

  it("FIELDS_V1 is the single source of field-name string literals (structural)", () => {
    // The values of FIELDS_V1 must be unique non-empty strings; this asserts
    // the table is well-formed (and serves as the contract the CI grep
    // enforces structurally in T-017).
    const values = Object.values(FIELDS_V1);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });
});
