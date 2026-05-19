/**
 * T-002 — Dense-blocks invariant (US-002, server side).
 *
 * Verifies the bridge backfills sparse `aitem.blocks` slots before any
 * index assignment so the array stays dense end-to-end (no null holes
 * after JSON.stringify). Placeholders carry the ADR-004 marker
 * `{ type: "text", text: "", _placeholder: true }` so the web filter can
 * drop them before discrimination.
 *
 * Test style: mirrors `bridge-partial-streaming.test.ts` — vitest, node
 * runtime, no jsdom. Drives the bridge via the `__test__` helpers exposed
 * for T-001 / T-003 / T-006 tests.
 *
 * What we assert (US-002 AC1, AC2 — server contribution):
 *
 *   AC1 (dense backfill): a `content_block_start` at `index: 3` on an
 *       assistant item with empty `blocks` produces a dense array of
 *       length 4 — placeholders at indices 0/1/2, the real block at 3.
 *
 *   AC2 (no nulls on wire): the JSON-serialised blocks (via
 *       `serializeServerFrame` AND direct `JSON.stringify`) contain NO
 *       `null` entries — the placeholders are real objects with type and
 *       `_placeholder: true`.
 *
 *   Additional behaviours under the same dense-array invariant:
 *     - Backfill is a no-op when `idx <= aitem.blocks.length`.
 *     - Unknown block types leave the placeholder block at that index
 *       (do NOT overwrite with undefined, which would re-introduce holes).
 *     - Two non-contiguous writes (text at 0, tool_use at 5) keep all
 *       four intermediate slots as placeholders.
 *
 * Wire-mirror drift guard: the `_placeholder?: boolean` extension on
 * `AssistantTextBlock` lands on BOTH `chat-protocol/messages.ts` and
 * `apps/web/src/lib/chat-types.ts`, so the existing
 * `wire-mirror-drift.test.ts` continues to pass (verified by running the
 * suite). This file does NOT duplicate that guard.
 */
import { describe, expect, test } from "vitest";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type { AssistantMessageItem } from "../src/chat-protocol/messages.ts";
import { serializeServerFrame } from "../src/chat-protocol/frames.ts";

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
    // The bridge mirrors every appendItem/updateItem into the durable
    // chat-items log. These tests bypass spawn() via
    // __test__installStubSession, but appendItem/updateItem still fire
    // — so we hand back a no-op repo. Persistence has its own coverage
    // in chat-items-rehydration.test.ts.
    chatItems: {
      list: () => [],
      append: () => {},
      update: () => {},
      clear: () => {},
    },
  } as unknown as MetadataStore;
}

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

describe("T-002 / US-002 — dense backfill on content_block_start (AC1)", () => {
  test("content_block_start at index 3 on empty blocks produces dense length-4 array with placeholders at 0/1/2", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-db-1", {});
    const session = bridge.__test__sessions().get("chat-db-1")!;

    bridge.__test__handleSdkMessage(
      "chat-db-1",
      makeStreamEvent("p1", makeMessageStartEvent("msg_sparse")),
    );
    // Sparse write — tool_use lands at idx=3 with nothing at 0/1/2.
    bridge.__test__handleSdkMessage(
      "chat-db-1",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(3, {
          type: "tool_use",
          id: "tool_abc",
          name: "TodoWrite",
          input: { todos: [] },
        }),
      ),
    );

    const item = session.itemsById.get("msg_sparse") as
      | AssistantMessageItem
      | undefined;
    expect(item).toBeDefined();
    expect(item!.blocks.length).toBe(4);

    // Indices 0/1/2 are placeholders with the canonical ADR-004 shape.
    for (const idx of [0, 1, 2]) {
      const block = item!.blocks[idx] as
        | { type?: string; text?: string; _placeholder?: boolean }
        | undefined;
      expect(block).toBeDefined();
      expect(block!.type).toBe("text");
      expect(block!.text).toBe("");
      expect(block!._placeholder).toBe(true);
    }

    // Index 3 is the real tool_use.
    const realBlock = item!.blocks[3] as { type: string; id: string; name: string };
    expect(realBlock.type).toBe("tool_use");
    expect(realBlock.id).toBe("tool_abc");
    expect(realBlock.name).toBe("TodoWrite");
  });
});

describe("T-002 / US-002 — JSON-stringify round-trip preserves dense invariant (AC2)", () => {
  test("the JSON-serialized blocks contain NO null entries; placeholders are real objects", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-db-2", {});
    const session = bridge.__test__sessions().get("chat-db-2")!;

    bridge.__test__handleSdkMessage(
      "chat-db-2",
      makeStreamEvent("p1", makeMessageStartEvent("msg_json")),
    );
    bridge.__test__handleSdkMessage(
      "chat-db-2",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(3, {
          type: "tool_use",
          id: "tool_xyz",
          name: "Bash",
          input: { command: "ls" },
        }),
      ),
    );

    const item = session.itemsById.get("msg_json") as AssistantMessageItem;
    expect(item).toBeDefined();

    // Direct JSON.stringify round-trip.
    const direct = JSON.parse(JSON.stringify(item.blocks)) as unknown[];
    expect(direct.length).toBe(4);
    for (const entry of direct) {
      expect(entry).not.toBeNull();
      expect(typeof entry).toBe("object");
    }

    // serializeServerFrame round-trip via item-append envelope.
    const wire = serializeServerFrame({
      kind: "item-append",
      "chat-id": "chat-db-2",
      body: { item },
    });
    expect(wire).not.toContain("null,"); // sanity: no `null,` array gaps
    const parsed = JSON.parse(wire) as {
      body: { item: { blocks: unknown[] } };
    };
    expect(parsed.body.item.blocks.length).toBe(4);
    for (const entry of parsed.body.item.blocks) {
      expect(entry).not.toBeNull();
    }
    // Verify the placeholder markers survived the round-trip.
    const wirePlaceholders = parsed.body.item.blocks.slice(0, 3) as Array<{
      type: string;
      text: string;
      _placeholder?: boolean;
    }>;
    for (const ph of wirePlaceholders) {
      expect(ph.type).toBe("text");
      expect(ph.text).toBe("");
      expect(ph._placeholder).toBe(true);
    }
  });
});

describe("T-002 / US-002 — backfill edge cases", () => {
  test("idx === aitem.blocks.length is a no-op (no extra placeholders inserted)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-db-3", {});
    const session = bridge.__test__sessions().get("chat-db-3")!;

    bridge.__test__handleSdkMessage(
      "chat-db-3",
      makeStreamEvent("p1", makeMessageStartEvent("msg_contig")),
    );
    bridge.__test__handleSdkMessage(
      "chat-db-3",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(0, { type: "text", text: "first" }),
      ),
    );
    bridge.__test__handleSdkMessage(
      "chat-db-3",
      makeStreamEvent(
        "p3",
        makeContentBlockStartEvent(1, { type: "text", text: "second" }),
      ),
    );

    const item = session.itemsById.get("msg_contig") as AssistantMessageItem;
    expect(item.blocks.length).toBe(2);
    expect(item.blocks[0]!.type).toBe("text");
    expect(item.blocks[1]!.type).toBe("text");
    // No placeholder markers anywhere.
    for (const b of item.blocks) {
      expect((b as { _placeholder?: boolean })._placeholder).toBeFalsy();
    }
  });

  test("unknown block type leaves the placeholder in place (does NOT overwrite with undefined)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-db-4", {});
    const session = bridge.__test__sessions().get("chat-db-4")!;

    bridge.__test__handleSdkMessage(
      "chat-db-4",
      makeStreamEvent("p1", makeMessageStartEvent("msg_unknown")),
    );
    // Future SDK block kind at idx=2 with everything-undefined slots at 0/1.
    bridge.__test__handleSdkMessage(
      "chat-db-4",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(2, { type: "future_kind" }),
      ),
    );

    const item = session.itemsById.get("msg_unknown") as AssistantMessageItem;
    expect(item.blocks.length).toBe(3);
    // Slots 0, 1 are placeholders (from the backfill loop).
    for (const idx of [0, 1]) {
      const b = item.blocks[idx] as { _placeholder?: boolean };
      expect(b._placeholder).toBe(true);
    }
    // Slot 2 — unknown block type, placeholder left in place (not undefined).
    const slot2 = item.blocks[2] as { _placeholder?: boolean } | undefined;
    expect(slot2).toBeDefined();
    expect(slot2!._placeholder).toBe(true);
    // JSON round-trip has no nulls.
    const direct = JSON.parse(JSON.stringify(item.blocks)) as unknown[];
    for (const entry of direct) expect(entry).not.toBeNull();
  });

  test("two non-contiguous writes (text at 0, tool_use at 5) leave four placeholders between", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-db-5", {});
    const session = bridge.__test__sessions().get("chat-db-5")!;

    bridge.__test__handleSdkMessage(
      "chat-db-5",
      makeStreamEvent("p1", makeMessageStartEvent("msg_twin")),
    );
    bridge.__test__handleSdkMessage(
      "chat-db-5",
      makeStreamEvent(
        "p2",
        makeContentBlockStartEvent(0, { type: "text", text: "lead" }),
      ),
    );
    bridge.__test__handleSdkMessage(
      "chat-db-5",
      makeStreamEvent(
        "p3",
        makeContentBlockStartEvent(5, {
          type: "tool_use",
          id: "tool_5",
          name: "Bash",
          input: {},
        }),
      ),
    );

    const item = session.itemsById.get("msg_twin") as AssistantMessageItem;
    expect(item.blocks.length).toBe(6);
    expect(item.blocks[0]!.type).toBe("text");
    expect((item.blocks[0] as { _placeholder?: boolean })._placeholder).toBeFalsy();
    for (const idx of [1, 2, 3, 4]) {
      const b = item.blocks[idx] as { _placeholder?: boolean; type: string };
      expect(b.type).toBe("text");
      expect(b._placeholder).toBe(true);
    }
    expect(item.blocks[5]!.type).toBe("tool_use");
    // No null after JSON round-trip.
    const direct = JSON.parse(JSON.stringify(item.blocks)) as unknown[];
    expect(direct.length).toBe(6);
    for (const entry of direct) expect(entry).not.toBeNull();
  });
});
