/**
 * T-002 — Bridge fans `images` into SDK content-block array (US-006 AC2-4).
 *
 * Verifies `submitUserTurnWithPriority` builds the SDK message content
 * correctly for image attachments per Gate G3 in `tests.md`:
 *
 *   - undefined / empty images ⇒ content is a plain string (legacy
 *     byte-compatible, US-006 AC4); UserMessageItem.images undefined.
 *   - text + images ⇒ content is [{type:"text", text}, ...image blocks];
 *     UserMessageItem.images mirrors the input.
 *   - empty text + non-empty images ⇒ submission ALLOWED; content is
 *     image-blocks-only; UserMessageItem.text === "".
 *   - empty text + no/empty images ⇒ rejected (preserves blank-input guard).
 *   - lifecycle !== "active" ⇒ buffered into pendingInput with content-
 *     block array preserved.
 *
 * Test style: matches `bridge-image-flatten.test.ts` — vitest, node,
 * no jsdom. Uses `__test__installStubSession` to capture pushed SDK
 * messages, and the test reads `appendItem` indirectly by inspecting
 * `session.items`.
 */
import { describe, expect, test } from "vitest";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type {
  UserMessageImage,
  UserMessageItem,
} from "../src/chat-protocol/messages.ts";
import type { UserTurnImage } from "../src/chat-protocol/frames.ts";

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
    chatItems: {
      list: () => [],
      append: () => {},
      update: () => {},
      clear: () => {},
    },
  } as unknown as MetadataStore;
}

interface Capture {
  msgs: any[];
}

function installCaptureSession(bridge: ClaudeSessionBridge, chatId: string): Capture {
  const c: Capture = { msgs: [] };
  bridge.__test__installStubSession(chatId, {
    capture: (msg) => c.msgs.push(msg),
  });
  return c;
}

const ONE_IMG: UserTurnImage[] = [
  { mediaType: "image/png", dataB64: "AA==", filename: "a.png" },
];

describe("T-002 submitUserTurnWithPriority — images fan-out (US-006 AC2-4)", () => {
  test("undefined images ⇒ content is plain string (legacy byte-compat)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const capture = installCaptureSession(bridge, "chat-A");
    bridge.submitUserTurnWithPriority("chat-A", "hi", "now", undefined);
    expect(capture.msgs.length).toBe(1);
    const sdk = capture.msgs[0];
    expect(typeof sdk.message.content).toBe("string");
    expect(sdk.message.content).toBe("hi");

    const items = bridge.__test__sessions().get("chat-A")!.items;
    const user = items.find((it) => it.kind === "user-message") as UserMessageItem;
    expect(user).toBeDefined();
    expect(user.images).toBeUndefined();
  });

  test("text + images ⇒ content is [text, ...image blocks]; UserMessageItem.images mirrors", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const capture = installCaptureSession(bridge, "chat-B");
    bridge.submitUserTurnWithPriority("chat-B", "hi", "now", ONE_IMG);
    const sdk = capture.msgs[0];
    expect(Array.isArray(sdk.message.content)).toBe(true);
    const content = sdk.message.content as any[];
    expect(content).toEqual([
      { type: "text", text: "hi" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AA==" },
      },
    ]);

    const items = bridge.__test__sessions().get("chat-B")!.items;
    const user = items.find((it) => it.kind === "user-message") as UserMessageItem;
    expect(user.images).toBeDefined();
    expect(user.images!.length).toBe(1);
    const mirrored: UserMessageImage = user.images![0];
    expect(mirrored.mediaType).toBe("image/png");
    expect(mirrored.dataB64).toBe("AA==");
    expect(mirrored.filename).toBe("a.png");
  });

  test("empty text + non-empty images ⇒ submission allowed; image-only content; item.text === ''", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const capture = installCaptureSession(bridge, "chat-C");
    bridge.submitUserTurnWithPriority("chat-C", "", "now", ONE_IMG);
    expect(capture.msgs.length).toBe(1);
    const content = capture.msgs[0].message.content as any[];
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBe(1);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "AA==" },
    });

    const items = bridge.__test__sessions().get("chat-C")!.items;
    const user = items.find((it) => it.kind === "user-message") as UserMessageItem;
    expect(user.text).toBe("");
    expect(user.images!.length).toBe(1);
  });

  test("empty text + no images ⇒ rejected (blank-input guard preserved)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const capture = installCaptureSession(bridge, "chat-D");
    bridge.submitUserTurnWithPriority("chat-D", "", "now", undefined);
    expect(capture.msgs.length).toBe(0);
    bridge.submitUserTurnWithPriority("chat-D", "   ", "now", []);
    expect(capture.msgs.length).toBe(0);
    const items = bridge.__test__sessions().get("chat-D")!.items;
    expect(items.filter((it) => it.kind === "user-message").length).toBe(0);
  });

  test("lifecycle !== 'active' ⇒ content-block array preserved in pendingInput buffer", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    installCaptureSession(bridge, "chat-E");
    const session = bridge.__test__sessions().get("chat-E")!;
    // Flip into recovering so the dispatch buffers instead of routing
    // through inputQueue.
    session.lifecycle = "recovering";
    bridge.submitUserTurnWithPriority("chat-E", "hi", "now", ONE_IMG);
    expect(session.pendingInput.length).toBe(1);
    const buffered = session.pendingInput[0];
    expect(Array.isArray(buffered.message.content)).toBe(true);
    const content = buffered.message.content as any[];
    expect(content).toEqual([
      { type: "text", text: "hi" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "AA==" },
      },
    ]);
  });
});
