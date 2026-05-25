/**
 * normalizeHookEvent — real Claude Code hook payload shape.
 *
 * Real claude POSTs `{hook_event_name, session_id, tool_name, tool_input,
 * ...}` to /hooks/event. The receiver resolves chatId upstream (reverse
 * lookup against SessionIdStore) and forwards it to normalize as the 2nd
 * arg. These tests pin that translation.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeHookEvent,
  PERMISSION_TOOLS,
} from "../src/hook-receiver/normalize.ts";

describe("normalizeHookEvent — Claude Code payload shape", () => {
  it("PreToolUse + AskUserQuestion → gate-pending askuserquestion with synthesised option ids", () => {
    const r = normalizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-abc",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            {
              question: "Which option?",
              header: "Dummy",
              multiSelect: false,
              options: [
                { label: "Option A", description: "first" },
                { label: "Option B" },
                { label: "Option C" },
              ],
            },
          ],
        },
      },
      "chat-1",
    );
    expect(r.pendingGate?.kind).toBe("askuserquestion");
    expect(r.envelopes).toHaveLength(1);
    const env = r.envelopes[0]!;
    expect(env.kind).toBe("gate-pending");
    expect(env["chat-id"]).toBe("chat-1");
    const body = env.body as {
      kind: string;
      data: {
        id: string;
        question: string;
        options: Array<{ id: string; label: string; description?: string }>;
      };
    };
    expect(body.kind).toBe("askuserquestion");
    expect(body.data.question).toBe("Which option?");
    expect(body.data.options).toEqual([
      { id: "opt-1", label: "Option A", description: "first" },
      { id: "opt-2", label: "Option B" },
      { id: "opt-3", label: "Option C" },
    ]);
    expect(typeof body.data.id).toBe("string");
    expect(body.data.id.length).toBeGreaterThan(0);
  });

  it("PreToolUse + AskUserQuestion (legacy singular shape) — still normalised for back-compat", () => {
    const r = normalizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-abc",
        tool_name: "AskUserQuestion",
        tool_input: {
          question: "Which option?",
          options: [
            { label: "Option A", description: "first" },
            { label: "Option B" },
            { label: "Option C" },
          ],
        },
      },
      "chat-1",
    );
    expect(r.pendingGate?.kind).toBe("askuserquestion");
    expect(r.envelopes).toHaveLength(1);
    const env = r.envelopes[0]!;
    expect(env.kind).toBe("gate-pending");
    expect(env["chat-id"]).toBe("chat-1");
    const body = env.body as {
      kind: string;
      data: {
        id: string;
        question: string;
        options: Array<{ id: string; label: string; description?: string }>;
      };
    };
    expect(body.kind).toBe("askuserquestion");
    expect(body.data.question).toBe("Which option?");
    expect(body.data.options).toEqual([
      { id: "opt-1", label: "Option A", description: "first" },
      { id: "opt-2", label: "Option B" },
      { id: "opt-3", label: "Option C" },
    ]);
  });

  it("PreToolUse + permission tool → pre-tool-use envelope (no gate row)", () => {
    expect(PERMISSION_TOOLS.has("Bash")).toBe(true);
    const r = normalizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-abc",
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
      },
      "chat-2",
    );
    expect(r.pendingGate).toBeUndefined();
    expect(r.envelopes).toHaveLength(1);
    const env = r.envelopes[0]!;
    expect(env.kind).toBe("pre-tool-use");
    expect(env["chat-id"]).toBe("chat-2");
    const body = env.body as {
      toolName: string;
      payload: { id: string; toolName: string; input: Record<string, unknown>; displayName: string };
    };
    expect(body.toolName).toBe("Bash");
    expect(body.payload.toolName).toBe("Bash");
    expect(body.payload.displayName).toBe("Bash");
    expect(body.payload.input).toEqual({ command: "rm -rf /" });
    expect(typeof body.payload.id).toBe("string");
  });

  it("PreToolUse + read-only tool (Read) → no envelope (dropped)", () => {
    const r = normalizeHookEvent(
      {
        hook_event_name: "PreToolUse",
        session_id: "sess-abc",
        tool_name: "Read",
        tool_input: { file_path: "/etc/hosts" },
      },
      "chat-3",
    );
    expect(r.envelopes).toEqual([]);
    expect(r.pendingGate).toBeUndefined();
  });

  it("legacy-shape PreToolUse + Bash still produces a pre-tool-use envelope", () => {
    // Back-compat with old loom-shape hook events (`channel`, `toolName`,
    // `payload`) so existing tests / fixtures keep working without rewrite.
    const r = normalizeHookEvent({
      channel: "PreToolUse",
      chatId: "chat-legacy",
      toolName: "Bash",
      payload: { id: "perm-pre-1", command: "ls" },
    });
    expect(r.envelopes).toHaveLength(1);
    const env = r.envelopes[0]!;
    expect(env.kind).toBe("pre-tool-use");
    expect(env["chat-id"]).toBe("chat-legacy");
    const body = env.body as { toolName: string; payload: { id: string } };
    expect(body.toolName).toBe("Bash");
    // Existing `id` in payload is preserved when present.
    expect(body.payload.id).toBe("perm-pre-1");
  });

  it("PostToolUse no longer intercepts AskUserQuestion — passthrough only", () => {
    const r = normalizeHookEvent(
      {
        hook_event_name: "PostToolUse",
        session_id: "sess-abc",
        tool_name: "AskUserQuestion",
        tool_input: { question: "?", options: [] },
      },
      "chat-4",
    );
    expect(r.pendingGate).toBeUndefined();
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]!.kind).toBe("post-tool-use");
  });

  it("Notification yields a notification envelope", () => {
    const r = normalizeHookEvent(
      {
        hook_event_name: "Notification",
        session_id: "sess-abc",
        message: "claude needs your attention",
      },
      "chat-5",
    );
    expect(r.envelopes).toHaveLength(1);
    expect(r.envelopes[0]!.kind).toBe("notification");
    expect(r.pendingGate).toBeUndefined();
  });
});
