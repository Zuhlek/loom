import { describe, expect, it } from "vitest";
import {
  FIELDS,
  parseLine,
  type ClaudeEvent,
  type ParseCtx,
} from "../src/process-manager/jsonl/schema.ts";

const ctx: ParseCtx = { chatId: "c-1", sessionId: "s-1" };

describe("jsonl/schema", () => {
  it("FIELDS contains the documented field-name string literals", () => {
    expect(FIELDS.TYPE).toBe("type");
    expect(FIELDS.UUID).toBe("uuid");
    expect(FIELDS.SESSION_ID).toBe("sessionId");
    expect(FIELDS.TIMESTAMP).toBe("timestamp");
    expect(FIELDS.MESSAGE).toBe("message");
    expect(FIELDS.CONTENT).toBe("content");
    expect(FIELDS.ROLE).toBe("role");
    expect(FIELDS.TOOL_USE_ID).toBe("tool_use_id");
    expect(FIELDS.TOOL_NAME).toBe("name");
    expect(FIELDS.INPUT).toBe("input");
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

  it("is deterministic: same input → deep-equal output across two calls", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-2",
      timestamp: "2026-05-23T01:00:00.000Z",
      message: { role: "user", content: "deterministic" },
    });
    expect(parseLine(line, ctx)).toEqual(parseLine(line, ctx));
  });

  it("skill_listing attachment becomes a slash_command_set of skills", () => {
    const line = JSON.stringify({
      type: "attachment",
      uuid: "u-skills",
      timestamp: "2026-05-23T00:00:00.000Z",
      attachment: {
        type: "skill_listing",
        skillCount: 2,
        isInitial: true,
        content: "- weave: Compose a fabric from threads.\n- forge: Curate learnings.",
        names: ["weave", "forge"],
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("slash_command_set");
    if (evt.kind === "slash_command_set") {
      expect(evt.commands).toEqual([
        {
          name: "weave",
          description: "Compose a fabric from threads.",
          argumentHint: "",
          kind: "skill",
        },
        {
          name: "forge",
          description: "Curate learnings.",
          argumentHint: "",
          kind: "skill",
        },
      ]);
    }
  });

  it("non-skill_listing attachments fall through to kind=unknown", () => {
    const line = JSON.stringify({
      type: "attachment",
      uuid: "u-att",
      timestamp: "2026-05-23T00:00:00.000Z",
      attachment: { type: "task_reminder" },
    });
    expect(parseLine(line, ctx).kind).toBe("unknown");
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

  it("classifies an `origin`-tagged user line (task-notification) as role=system", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-notif",
      timestamp: "2026-05-23T00:00:00.000Z",
      origin: { kind: "task-notification" },
      promptSource: "system",
      message: {
        role: "user",
        content: "<task-notification>\n<task-id>bszpivywq</task-id>\n</task-notification>",
      },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") {
      expect(evt.role).toBe("system");
      expect(evt.text).toContain("task-notification");
    }
  });

  it("hides an isMeta hook-feedback user line (Stop hook block reason) as unknown", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-hook",
      timestamp: "2026-05-23T00:00:00.000Z",
      isMeta: true,
      message: {
        role: "user",
        content: "Stop hook feedback:\nLoom project 'x' is ready to advance in build. Run `/weave x`.",
      },
    });
    expect(parseLine(line, ctx).kind).toBe("unknown");
  });

  it("keeps a human turn that merely mentions hook feedback (no isMeta) as role=user", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-human-hook",
      timestamp: "2026-05-23T00:00:00.000Z",
      message: { role: "user", content: "Stop hook feedback: why does this fire?" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") expect(evt.role).toBe("user");
  });

  it("classifies a `promptSource:system` user line as role=system even without origin", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-sys",
      timestamp: "2026-05-23T00:00:00.000Z",
      promptSource: "system",
      message: { role: "user", content: "<system-reminder>be nice</system-reminder>" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") expect(evt.role).toBe("system");
  });

  it("keeps a genuine human turn (promptSource:typed, no origin) as role=user", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-typed",
      timestamp: "2026-05-23T00:00:00.000Z",
      promptSource: "typed",
      message: { role: "user", content: "hello" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") expect(evt.role).toBe("user");
  });

  it("keeps a human turn tagged origin:{kind:human} as role=user (dup-prompt fix)", () => {
    // Current claude stamps typed turns with an origin object. Treating any
    // origin object as injected rendered the real turn as a system notice, so
    // the optimistic bubble never reconciled and the prompt showed twice.
    const line = JSON.stringify({
      type: "user",
      uuid: "u-human-origin",
      timestamp: "2026-05-23T00:00:00.000Z",
      origin: { kind: "human" },
      promptSource: "typed",
      message: { role: "user", content: "hi" },
    });
    const evt = parseLine(line, ctx);
    expect(evt.kind).toBe("text");
    if (evt.kind === "text") expect(evt.role).toBe("user");
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

  it("FIELDS is the single source of field-name string literals (structural)", () => {
    // The values of FIELDS must be unique non-empty strings; this asserts the
    // table is well-formed (and serves as the contract the CI grep enforces
    // structurally).
    const values = Object.values(FIELDS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });
});
