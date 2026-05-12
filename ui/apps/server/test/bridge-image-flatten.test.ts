/**
 * T-006 — Bridge image-flatten test (server side).
 *
 * Verifies US-006 AC1 + ADR-006 (data-URLs) + ADR-007 (extended
 * `ToolResultSummary`):
 *
 *   AC1 (bridge): `flattenResultContent` (formerly `flattenResultText`)
 *                 walks the SDK's tool_result content array and:
 *                   - accumulates `text` blocks into a joined string;
 *                   - accumulates `image` blocks into an `images` array
 *                     of `{ mediaType, dataB64 }` entries.
 *                 The bridge's `onUserMessage` then writes the returned
 *                 `images` onto `ToolResultSummary.images`.
 *
 *   ADR-006:    image transport is the SDK's base64 + media-type payload
 *                 piped straight through; the bridge does NOT mint blob
 *                 URLs or write bytes to a server route.
 *
 *   ADR-007:    `ToolResultSummary.images` is an OPTIONAL array of
 *                 `ToolResultImage` entries; legacy text-only results
 *                 leave the field absent.
 *
 * Test style: matches T-001/T-002/T-004 server tests (vitest, node
 * runtime, no jsdom). The bridge is driven via the existing
 * `__test__installStubSession` + a small helper that synthesises a
 * `user` SDK message (tool_result content array) and routes it through
 * the bridge's private `onUserMessage` via a tiny test surface.
 *
 * RED path:
 *   Before implementation, `flattenResultText` only handles text blocks;
 *   image blocks are silently dropped. `ToolResultSummary` has no
 *   `images` field; the test's assertion that the bridge writes
 *   `result.images` fails at runtime (the field is undefined). The
 *   chat-types mirror also lacks the field; the static type imports
 *   would fail unless the field is declared optional first.
 *
 * GREEN path: bridge renames to `flattenResultContent`, returns
 * `{ text, images? }`; `ToolResultSummary` carries `images?`; web
 * mirror has the same.
 */
import { describe, expect, test } from "vitest";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type {
  AssistantMessageItem,
  AssistantToolUseBlock,
  ToolResultImage,
  ToolResultSummary,
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
 * Build a minimal SDKUserMessage-shaped object carrying a tool_result
 * with the given content blocks. The bridge reads
 * `msg.message.content` and walks each tool_result's `content` array
 * for text + image blocks.
 */
function makeSdkUserMessage(toolUseId: string, content: unknown[]) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          is_error: false,
        },
      ],
    },
  };
}

/**
 * Install a session and seed a pending tool_use block on an assistant
 * message so the bridge has somewhere to write the result. Returns the
 * mutated `AssistantToolUseBlock` for inspection.
 */
function seedToolUse(bridge: ClaudeSessionBridge, chatId: string, toolUseId: string): {
  block: AssistantToolUseBlock;
  message: AssistantMessageItem;
} {
  bridge.__test__installStubSession(chatId, {});
  const session = bridge.__test__sessions().get(chatId)!;
  const assistantId = "assistant-1";
  const block: AssistantToolUseBlock = {
    type: "tool_use",
    id: toolUseId,
    name: "ImageTool",
    input: {},
    status: "running",
  };
  const message: AssistantMessageItem = {
    kind: "assistant-message",
    id: assistantId,
    turnId: session.currentTurnId,
    blocks: [block],
    streaming: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  session.items.push(message);
  session.itemsById.set(assistantId, message);
  session.toolUseToAssistantId.set(toolUseId, assistantId);
  return { block, message };
}

describe("T-006 bridge — flattenResultContent walks image blocks (US-006 AC1, ADR-006/007)", () => {
  test("a single SDK image block lands on result.images as base64 + mediaType", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const { block } = seedToolUse(bridge, "chat-img-1", "tool-1");

    const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const msg = makeSdkUserMessage("tool-1", [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: pngB64 },
      },
    ]);

    bridge.__test__handleSdkMessage("chat-img-1", msg);

    const result = block.result;
    expect(result).toBeDefined();
    // Legacy text path: empty when there are no text blocks.
    expect(result!.text).toBe("");
    expect(result!.isError).toBe(false);
    // ADR-007: images array carries the parsed block.
    expect(result!.images).toBeDefined();
    expect(result!.images!.length).toBe(1);
    const img: ToolResultImage = result!.images![0];
    expect(img.mediaType).toBe("image/png");
    expect(img.dataB64).toBe(pngB64);
  });

  test("multiple image blocks are preserved in order alongside text", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const { block } = seedToolUse(bridge, "chat-img-2", "tool-2");

    const a = "AAAA";
    const b = "BBBB";
    const c = "CCCC";
    const msg = makeSdkUserMessage("tool-2", [
      { type: "text", text: "Here are three frames:" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: a },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/webp", data: c },
      },
    ]);

    bridge.__test__handleSdkMessage("chat-img-2", msg);

    const result = block.result;
    expect(result).toBeDefined();
    expect(result!.text).toBe("Here are three frames:");
    expect(result!.images).toBeDefined();
    expect(result!.images!.length).toBe(3);
    expect(result!.images!.map((i) => i.dataB64)).toEqual([a, b, c]);
    expect(result!.images!.map((i) => i.mediaType)).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  });

  test("text-only tool_result has no images field (legacy compat)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const { block } = seedToolUse(bridge, "chat-img-3", "tool-3");

    const msg = makeSdkUserMessage("tool-3", [
      { type: "text", text: "just text" },
    ]);

    bridge.__test__handleSdkMessage("chat-img-3", msg);

    const result = block.result;
    expect(result).toBeDefined();
    expect(result!.text).toBe("just text");
    // Legacy back-compat: when no image blocks are present, the field
    // is either omitted or an empty array — both are acceptable per
    // ADR-007's "optional" wording.
    const images = result!.images;
    expect(images === undefined || images.length === 0).toBe(true);
  });

  test("string-typed tool_result content keeps the legacy text path", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const { block } = seedToolUse(bridge, "chat-img-4", "tool-4");

    // Some MCP tools deliver a plain string content (not an array).
    // The bridge must still flatten that path AND set images = undefined.
    const msg = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-4",
            content: "plain string body",
            is_error: false,
          },
        ],
      },
    };

    bridge.__test__handleSdkMessage("chat-img-4", msg);

    const result = block.result;
    expect(result).toBeDefined();
    expect(result!.text).toBe("plain string body");
    const images = result!.images;
    expect(images === undefined || images.length === 0).toBe(true);
  });
});

describe("T-006 ToolResultSummary mirror — `images` field (ADR-007)", () => {
  test("the type carries an optional `images` array of `ToolResultImage`", () => {
    // Compile-time assertion: the type must accept an `images` field.
    // (No runtime side-effect; this is a type-only check.)
    const img: ToolResultImage = { mediaType: "image/png", dataB64: "AAAA" };
    const summary: ToolResultSummary = {
      text: "",
      isError: false,
      images: [img],
    };
    expect(summary.images?.[0].mediaType).toBe("image/png");
  });
});
