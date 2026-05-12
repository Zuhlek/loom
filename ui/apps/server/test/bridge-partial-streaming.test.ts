/**
 * T-001 — Stable streaming-item identity (US-001).
 *
 * Verifies US-001 acceptance criteria on the server side:
 *
 *   AC1 (bridge): when `onPartial` observes a `message_start` event with
 *       `event.message.id === "msg_abc"`, the bridge captures the id in
 *       `session.currentMessageStartId` and emits NO item (the
 *       `message_start` branch returns before any item write).
 *
 *   AC2 (bridge): with `currentMessageStartId` set, two successive
 *       `content_block_start` events route to a SINGLE
 *       `AssistantMessageItem` keyed by `message.id`.
 *
 *   AC3 (bridge): two `message_start` events back-to-back (separated by
 *       `message_stop`) produce TWO distinct assistant items, both with
 *       the same `turnId`. Multi-tool / multi-SDK-message rendering.
 *
 *   AC4 (bridge — partial stream regression guard): 50 successive
 *       partials under one `message_start` produce exactly one row.
 *
 *   AC5 (bridge — audit-trail fallback): if `content_block_start` fires
 *       without a prior `message_start`, the resolver falls back to
 *       `msg.uuid` keying AND logs a warning.
 *
 *   AC4 (paired `onAssistant` migration / ADR-007): the canonical
 *       `assistant` SDK message with `.message.id === "msg_abc"`
 *       coalesces with the streaming item (no duplicate row appended).
 *
 *   AC4 (paired `onAssistant` fallback): if the canonical
 *       `SDKAssistantMessage` is missing `.message.id`, fall back to
 *       `msg.uuid` keying + a warning.
 *
 *   Lifecycle: `message_stop` clears `currentMessageStartId`;
 *       `submitUserTurnWithPriority` resets it explicitly for symmetry
 *       with the state-flow diagram in design.md.
 *
 * Test style: matches T-003's `bridge-plan-proposed.test.ts` and T-006's
 * `bridge-image-flatten.test.ts` (vitest, node runtime, no jsdom). The
 * bridge is driven via `__test__installStubSession` +
 * `__test__handleSdkMessage`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type {
  AssistantMessageItem,
} from "../src/chat-protocol/messages.ts";

function makeStubStore(): MetadataStore {
  const fail = () => {
    throw new Error("store should not be called by these unit tests");
  };
  return {
    chats: {
      get: fail,
      setSessionId: fail,
      markActive: fail,
      markInert: fail,
    },
  } as unknown as MetadataStore;
}

/**
 * Build a minimal `stream_event` SDK message carrying the given raw
 * Anthropic streaming event. Mirrors `SDKPartialAssistantMessage` shape
 * (sdk.d.ts:3189-3196).
 */
function makeStreamEvent(uuid: string, event: unknown) {
  return {
    type: "stream_event",
    uuid,
    parent_tool_use_id: null,
    session_id: "stub-session",
    event,
  };
}

function makeMessageStartEvent(messageId: string) {
  return {
    type: "message_start",
    message: { id: messageId },
  };
}

function makeContentBlockStartEvent(idx: number, block: unknown) {
  return {
    type: "content_block_start",
    index: idx,
    content_block: block,
  };
}

function makeContentBlockDeltaEvent(
  idx: number,
  delta: { type: string; text?: string; thinking?: string },
) {
  return {
    type: "content_block_delta",
    index: idx,
    delta,
  };
}

function makeMessageStopEvent() {
  return { type: "message_stop" };
}

/**
 * Build a canonical `assistant` SDK message with the given upstream
 * `message.id`. Mirrors `SDKAssistantMessage` shape (sdk.d.ts:2484-2491).
 */
function makeAssistantMessage(
  uuid: string,
  messageId: string,
  content: unknown[],
) {
  return {
    type: "assistant",
    uuid,
    parent_tool_use_id: null,
    session_id: "stub-session",
    message: {
      id: messageId,
      role: "assistant",
      content,
    },
  };
}

describe("T-001 / US-001 — onPartial `message_start` branch (AC1)", () => {
  test("captures `event.message.id` into session.currentMessageStartId and emits no item", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-1", {});
    const session = bridge.__test__sessions().get("chat-ms-1")!;

    const msg = makeStreamEvent(
      "partial-uuid-1",
      makeMessageStartEvent("msg_abc"),
    );
    bridge.__test__handleSdkMessage("chat-ms-1", msg);

    expect(
      (session as unknown as { currentMessageStartId: string | null })
        .currentMessageStartId,
    ).toBe("msg_abc");
    expect(session.itemsById.size).toBe(0);
    expect(session.items.length).toBe(0);
  });
});

describe("T-001 / US-001 — multi-batch coalescing onto one row (AC2)", () => {
  test("after `message_start`, two successive `content_block_start` events route to ONE assistant item keyed by message.id", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-2", {});
    const session = bridge.__test__sessions().get("chat-ms-2")!;

    bridge.__test__handleSdkMessage(
      "chat-ms-2",
      makeStreamEvent("p-uuid-a", makeMessageStartEvent("msg_abc")),
    );
    // First batch — different SDK partial uuid (the bug we are fixing).
    bridge.__test__handleSdkMessage(
      "chat-ms-2",
      makeStreamEvent(
        "p-uuid-b",
        makeContentBlockStartEvent(0, { type: "text", text: "Hello " }),
      ),
    );
    // Second batch — different SDK partial uuid, same logical message.
    bridge.__test__handleSdkMessage(
      "chat-ms-2",
      makeStreamEvent(
        "p-uuid-c",
        makeContentBlockStartEvent(1, { type: "text", text: "world." }),
      ),
    );
    // A delta on block 0.
    bridge.__test__handleSdkMessage(
      "chat-ms-2",
      makeStreamEvent(
        "p-uuid-d",
        makeContentBlockDeltaEvent(0, { type: "text_delta", text: "more " }),
      ),
    );

    const item = session.itemsById.get("msg_abc") as
      | AssistantMessageItem
      | undefined;
    expect(item).toBeDefined();
    expect(item!.kind).toBe("assistant-message");
    expect(item!.id).toBe("msg_abc");
    // Only ONE assistant item across all partials.
    const assistantItems = session.items.filter(
      (it) => it.kind === "assistant-message",
    );
    expect(assistantItems.length).toBe(1);
    // The partial uuids never created their own rows.
    expect(session.itemsById.get("p-uuid-b")).toBeUndefined();
    expect(session.itemsById.get("p-uuid-c")).toBeUndefined();
    expect(session.itemsById.get("p-uuid-d")).toBeUndefined();
  });
});

describe("T-001 / US-001 — multi-SDK-message turn (AC3)", () => {
  test("two `message_start` events back-to-back (with `message_stop` between) create TWO distinct rows sharing one turnId", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-3", {});
    const session = bridge.__test__sessions().get("chat-ms-3")!;
    const turnIdBefore = session.currentTurnId;

    // First SDK message.
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent("p1", makeMessageStartEvent("msg_aaa")),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(0, { type: "text", text: "first" }),
      ),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent("p3", makeMessageStopEvent()),
    );

    // Second SDK message in the same turn.
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent("p4", makeMessageStartEvent("msg_bbb")),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent(
        "p5",
        makeContentBlockStartEvent(0, { type: "text", text: "second" }),
      ),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-3",
      makeStreamEvent("p6", makeMessageStopEvent()),
    );

    const a = session.itemsById.get("msg_aaa") as
      | AssistantMessageItem
      | undefined;
    const b = session.itemsById.get("msg_bbb") as
      | AssistantMessageItem
      | undefined;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.id).toBe("msg_aaa");
    expect(b!.id).toBe("msg_bbb");
    // Both rows belong to the same user turn (US-001 AC-3).
    expect(a!.turnId).toBe(turnIdBefore);
    expect(b!.turnId).toBe(turnIdBefore);
  });
});

describe("T-001 / US-001 — 50-partial regression guard (AC4)", () => {
  test("50 successive content_block_delta events under one message_start produce exactly one assistant item", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-4", {});
    const session = bridge.__test__sessions().get("chat-ms-4")!;

    bridge.__test__handleSdkMessage(
      "chat-ms-4",
      makeStreamEvent("p-start", makeMessageStartEvent("msg_long")),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-4",
      makeStreamEvent(
        "p-cb-start",
        makeContentBlockStartEvent(0, { type: "text", text: "" }),
      ),
    );

    for (let i = 0; i < 50; i++) {
      bridge.__test__handleSdkMessage(
        "chat-ms-4",
        makeStreamEvent(
          `p-delta-${i}`,
          makeContentBlockDeltaEvent(0, { type: "text_delta", text: "x" }),
        ),
      );
    }

    const assistantItems = session.items.filter(
      (it) => it.kind === "assistant-message",
    );
    expect(assistantItems.length).toBe(1);
    expect(assistantItems[0]!.id).toBe("msg_long");
  });
});

describe("T-001 / US-001 — missing-message_start fallback + warning (AC5)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("content_block_start without prior message_start falls back to msg.uuid keying and warns", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-5", {});
    const session = bridge.__test__sessions().get("chat-ms-5")!;

    // No message_start fed; resolver should fall back to msg.uuid.
    bridge.__test__handleSdkMessage(
      "chat-ms-5",
      makeStreamEvent(
        "fallback-uuid-xyz",
        makeContentBlockStartEvent(0, { type: "text", text: "hi" }),
      ),
    );

    // Item is keyed by the partial msg.uuid (NOT a message.id).
    const item = session.itemsById.get("fallback-uuid-xyz") as
      | AssistantMessageItem
      | undefined;
    expect(item).toBeDefined();
    expect(item!.id).toBe("fallback-uuid-xyz");
    // Warning surfaced with the audit-trail context.
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat().join(" ");
    expect(warnArgs).toMatch(/message_start was not observed/i);
  });
});

describe("T-001 / US-001 — paired onAssistant migration (AC4, ADR-007)", () => {
  test("canonical assistant SDK message with .message.id coalesces with the streaming row (no duplicate)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-6", {});
    const session = bridge.__test__sessions().get("chat-ms-6")!;

    // Stream the partial path.
    bridge.__test__handleSdkMessage(
      "chat-ms-6",
      makeStreamEvent("p1", makeMessageStartEvent("msg_abc")),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-6",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(0, { type: "text", text: "streaming" }),
      ),
    );

    // Canonical assistant arrives. msg.uuid is DIFFERENT from msg.message.id.
    bridge.__test__handleSdkMessage(
      "chat-ms-6",
      makeAssistantMessage("canonical-uuid-different", "msg_abc", [
        { type: "text", text: "final canonical content" },
      ]),
    );

    const item = session.itemsById.get("msg_abc") as
      | AssistantMessageItem
      | undefined;
    expect(item).toBeDefined();
    // Final-message blocks REPLACED the streaming blocks.
    expect(item!.streaming).toBe(false);
    expect(item!.blocks.length).toBe(1);
    expect(item!.blocks[0]!.type).toBe("text");
    expect((item!.blocks[0] as { text: string }).text).toBe(
      "final canonical content",
    );
    // No row was appended under msg.uuid; we coalesced on message.id.
    expect(session.itemsById.get("canonical-uuid-different")).toBeUndefined();
    const assistantItems = session.items.filter(
      (it) => it.kind === "assistant-message",
    );
    expect(assistantItems.length).toBe(1);
  });

  test("fallback: assistant message missing .message.id keys by msg.uuid + warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
      bridge.__test__installStubSession("chat-ms-7", {});
      const session = bridge.__test__sessions().get("chat-ms-7")!;

      // Canonical assistant message lacking .message.id.
      bridge.__test__handleSdkMessage("chat-ms-7", {
        type: "assistant",
        uuid: "asst-uuid-only",
        parent_tool_use_id: null,
        session_id: "stub-session",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
      });

      const item = session.itemsById.get("asst-uuid-only") as
        | AssistantMessageItem
        | undefined;
      expect(item).toBeDefined();
      expect(item!.id).toBe("asst-uuid-only");
      expect(warnSpy).toHaveBeenCalled();
      const warnArgs = warnSpy.mock.calls.flat().join(" ");
      expect(warnArgs).toMatch(/missing message\.id/i);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("T-001 / US-001 — currentMessageStartId lifecycle", () => {
  test("`message_stop` clears currentMessageStartId after flipping streaming=false", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-8", {});
    const session = bridge.__test__sessions().get("chat-ms-8")!;

    bridge.__test__handleSdkMessage(
      "chat-ms-8",
      makeStreamEvent("p1", makeMessageStartEvent("msg_abc")),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-8",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(0, { type: "text", text: "x" }),
      ),
    );
    bridge.__test__handleSdkMessage(
      "chat-ms-8",
      makeStreamEvent("p3", makeMessageStopEvent()),
    );

    const item = session.itemsById.get("msg_abc") as
      | AssistantMessageItem
      | undefined;
    expect(item).toBeDefined();
    expect(item!.streaming).toBe(false);
    expect(
      (session as unknown as { currentMessageStartId: string | null })
        .currentMessageStartId,
    ).toBeNull();
  });

  test("after submitUserTurnWithPriority on a fresh session, currentMessageStartId stays null", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-ms-9", {});
    const session = bridge.__test__sessions().get("chat-ms-9")!;

    // Pre-condition: bridge-internal scratch is null.
    expect(
      (session as unknown as { currentMessageStartId: string | null })
        .currentMessageStartId,
    ).toBeNull();

    bridge.submitUserTurnWithPriority("chat-ms-9", "hello", "now");

    expect(
      (session as unknown as { currentMessageStartId: string | null })
        .currentMessageStartId,
    ).toBeNull();
  });
});
