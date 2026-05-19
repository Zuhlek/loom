/**
 * Pure unit tests for the timeline-rows grouping helper. The interesting
 * case: consecutive assistant-messages that contain ONLY tool_use blocks
 * collapse into a single "work-group" row with all tools flattened.
 */
import { describe, expect, test } from "vitest";

import {
  classifyAssistantMessage,
  deriveTimelineRows,
} from "../src/lib/timeline-rows";
import type {
  AssistantMessageItem,
  AssistantToolUseBlock,
  ChatItem,
  UserMessageItem,
} from "../src/lib/chat-types";

function user(id: string, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id,
    turnId: "t1",
    text,
    createdAt: "2026-05-12T18:56:00.000Z",
  };
}

function tool(id: string, name: string): AssistantToolUseBlock {
  return { type: "tool_use", id, name, input: {}, status: "complete" };
}

function asstWith(id: string, blocks: AssistantMessageItem["blocks"]): AssistantMessageItem {
  return {
    kind: "assistant-message",
    id,
    turnId: "t1",
    blocks,
    streaming: false,
    createdAt: "2026-05-12T18:57:00.000Z",
    updatedAt: "2026-05-12T18:57:00.000Z",
  };
}

describe("classifyAssistantMessage", () => {
  test('"work-group" for a single tool_use block', () => {
    expect(classifyAssistantMessage(asstWith("a1", [tool("t1", "Bash")]))).toBe("work-group");
  });

  test('"work-group" when text blocks are empty / whitespace', () => {
    expect(
      classifyAssistantMessage(
        asstWith("a1", [{ type: "text", text: "  " }, tool("t1", "Bash")]),
      ),
    ).toBe("work-group");
  });

  test('"assistant" when text block has real content', () => {
    expect(
      classifyAssistantMessage(
        asstWith("a1", [{ type: "text", text: "Let me check…" }, tool("t1", "Bash")]),
      ),
    ).toBe("assistant");
  });

  test('"work-group" even while streaming — prevents the row → group reclassification flicker', () => {
    const msg = asstWith("a1", [tool("t1", "Bash")]);
    msg.streaming = true;
    expect(classifyAssistantMessage(msg)).toBe("work-group");
  });

  test('"assistant" for a text-only message', () => {
    expect(
      classifyAssistantMessage(asstWith("a1", [{ type: "text", text: "hi" }])),
    ).toBe("assistant");
  });

  test("placeholder text blocks are ignored", () => {
    expect(
      classifyAssistantMessage(
        asstWith("a1", [
          { type: "text", text: "", _placeholder: true } as AssistantMessageItem["blocks"][0],
          tool("t1", "Bash"),
        ]),
      ),
    ).toBe("work-group");
  });

  test('"skip" for an empty streaming placeholder (WorkingChip covers the UX)', () => {
    const msg = asstWith("a1", []);
    msg.streaming = true;
    expect(classifyAssistantMessage(msg)).toBe("skip");
  });

  test('"assistant" for an empty non-streaming message (defensive fallback)', () => {
    expect(classifyAssistantMessage(asstWith("a1", []))).toBe("assistant");
  });
});

describe("deriveTimelineRows", () => {
  test("emits one row per non-grouped item, in order", () => {
    const items: ChatItem[] = [
      user("u1", "hi"),
      asstWith("a1", [{ type: "text", text: "hello" }]),
    ];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
  });

  test("collapses N consecutive tool-only assistant-messages into one work-group", () => {
    const items: ChatItem[] = [
      user("u1", "find foo"),
      asstWith("a1", [tool("t1", "Bash")]),
      asstWith("a2", [tool("t2", "Glob")]),
      asstWith("a3", [tool("t3", "Grep")]),
      asstWith("a4", [{ type: "text", text: "Here is what I found." }]),
    ];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["user", "work-group", "assistant"]);
    const group = rows[1] as Extract<ReturnType<typeof deriveTimelineRows>[number], { kind: "work-group" }>;
    expect(group.tools.map((t) => t.block.name)).toEqual(["Bash", "Glob", "Grep"]);
    expect(group.tools.map((t) => t.sourceMessageId)).toEqual(["a1", "a2", "a3"]);
  });

  test("mixed-content message (text + tool) is NOT grouped — renders inline", () => {
    const items: ChatItem[] = [
      asstWith("a1", [{ type: "text", text: "checking…" }, tool("t1", "Bash")]),
      asstWith("a2", [tool("t2", "Glob")]),
    ];
    const rows = deriveTimelineRows(items);
    // The mixed message renders as its own assistant row; the trailing
    // tool-only message becomes a one-entry work group.
    expect(rows.map((r) => r.kind)).toEqual(["assistant", "work-group"]);
  });

  test("a streaming tool-only message IS grouped — no row→group flicker on finalize", () => {
    const streaming = asstWith("a1", [tool("t1", "Bash")]);
    streaming.streaming = true;
    const items: ChatItem[] = [streaming];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["work-group"]);
  });

  test("a tool-only message followed by a streaming tool-only message stays in one group", () => {
    const streaming = asstWith("a2", [tool("t2", "Glob")]);
    streaming.streaming = true;
    const items: ChatItem[] = [asstWith("a1", [tool("t1", "Bash")]), streaming];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["work-group"]);
    const group = rows[0] as Extract<ReturnType<typeof deriveTimelineRows>[number], { kind: "work-group" }>;
    expect(group.tools.map((t) => t.block.name)).toEqual(["Bash", "Glob"]);
  });

  test("an empty streaming placeholder between two tool-only messages does not split the group", () => {
    const empty = asstWith("a2", []);
    empty.streaming = true;
    const items: ChatItem[] = [
      asstWith("a1", [tool("t1", "Bash")]),
      empty,
      asstWith("a3", [tool("t3", "Glob")]),
    ];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["work-group"]);
    const group = rows[0] as Extract<ReturnType<typeof deriveTimelineRows>[number], { kind: "work-group" }>;
    expect(group.tools.map((t) => t.block.name)).toEqual(["Bash", "Glob"]);
  });

  test("user messages between tool-only groups split the group", () => {
    const items: ChatItem[] = [
      asstWith("a1", [tool("t1", "Bash")]),
      user("u1", "also look here"),
      asstWith("a2", [tool("t2", "Glob")]),
    ];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["work-group", "user", "work-group"]);
  });

  test("preserves plan-proposed and system-notice rows in place", () => {
    const items: ChatItem[] = [
      {
        kind: "system-notice",
        id: "s1",
        text: "session started",
        level: "info",
        createdAt: "2026-05-12T18:55:00.000Z",
      },
      asstWith("a1", [tool("t1", "Bash")]),
      {
        kind: "plan-proposed",
        id: "p1",
        ts: 1,
        planText: "do X",
        status: "pending",
      },
    ];
    const rows = deriveTimelineRows(items);
    expect(rows.map((r) => r.kind)).toEqual(["system", "work-group", "plan-proposed"]);
  });
});
