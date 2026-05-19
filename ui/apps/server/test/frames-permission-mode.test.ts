/**
 * T-004 — Composer permission-mode + queue-priority controls.
 *
 * Verifies US-004 acceptance criteria on the server side:
 *   AC1 (wire): the new `permission-mode-set` ClientFrame variant exists
 *       in the union and round-trips through JSON with the four SDK
 *       PermissionMode values.
 *   AC2 (bridge): `bridge.setPermissionMode(chatId, mode)` calls
 *       `Query.setPermissionMode(mode)` exactly once with the same value.
 *   AC4 (bridge): `bridge.submitUserTurnWithPriority(chatId, text, "next")`
 *       pushes an SDKUserMessage onto the UserMessageQueue whose
 *       `priority` field equals `"next"`.
 *   AC4 wire: the existing `user-turn` ClientFrame body now accepts an
 *       optional `priority?: "now" | "next" | "later"` field per Design
 *       `## Wire protocol additions` (the SDK's own priority enum, no
 *       translation table per Design "matches SDK exactly").
 *
 * RED path:
 *   - Before implementation, `bridge.setPermissionMode` and
 *     `bridge.submitUserTurnWithPriority` are stubs that throw
 *     `not implemented`. The runtime expects fail.
 *   - The ClientFrame union does NOT yet contain
 *     `PermissionModeSetFrame` and `UserTurnFrame.body.priority`,
 *     so the type-level `expectTypeOf` checks would also fail —
 *     but the stubs above keep the file compiling.
 *
 * GREEN path: the bridge methods drive the SDK Query handle and the
 * user-message queue with the expected payloads.
 */
import { describe, test, expect, expectTypeOf, vi } from "vitest";
import {
  serializeServerFrame,
  type ClientFrame,
  type PermissionModeSetFrame,
  type ServerFrame,
  type UserTurnFrame,
} from "../src/chat-protocol/frames.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";

// SDK PermissionMode values mirrored on the wire. The union does NOT
// include the SDK-internal `dontAsk` / `auto` modes — only the four
// modes US-004 AC1 enumerates.
const SDK_MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;
type WirePermissionMode = (typeof SDK_MODES)[number];

describe("ClientFrame — permission-mode-set variant (US-004 AC1/AC2 wire)", () => {
  test("`permission-mode-set` is a member of the ClientFrame union with the four SDK PermissionMode values", () => {
    expectTypeOf<PermissionModeSetFrame>().toMatchTypeOf<ClientFrame>();

    for (const mode of SDK_MODES) {
      const frame = {
        kind: "permission-mode-set",
        "chat-id": "c1",
        body: { mode },
      } satisfies ClientFrame;
      expect(frame.body.mode).toBe(mode);
    }
  });

  test("the body.mode field is typed exactly to the four PermissionMode values", () => {
    // Compile-time check: assignment of a foreign string must be rejected
    // by TypeScript. Encoded as a runtime no-op assertion so the test
    // file is `tsc --noEmit`-checked end to end.
    type Mode = PermissionModeSetFrame["body"]["mode"];
    expectTypeOf<Mode>().toEqualTypeOf<
      "default" | "plan" | "acceptEdits" | "bypassPermissions"
    >();
  });
});

describe("ClientFrame — user-turn priority extension (US-004 AC4 wire)", () => {
  test("UserTurnFrame.body.priority is optional and accepts the SDK priority enum", () => {
    // `priority` is optional — existing `{ text }`-only submits still parse.
    const without: UserTurnFrame = {
      kind: "user-turn",
      "chat-id": "c1",
      body: { text: "hello" },
    };
    expect(without.body.priority).toBeUndefined();

    // With priority set, the field is typed as the SDK enum.
    const withNext: UserTurnFrame = {
      kind: "user-turn",
      "chat-id": "c1",
      body: { text: "hello", priority: "next" },
    };
    expect(withNext.body.priority).toBe("next");

    // Type-level: the priority field's domain is the SDK's enum.
    type P = NonNullable<UserTurnFrame["body"]["priority"]>;
    expectTypeOf<P>().toEqualTypeOf<"now" | "next" | "later">();
  });
});

describe("serializeServerFrame still funnels typed frames", () => {
  test("the helper is unchanged for ServerFrame variants (regression guard)", () => {
    const frame: ServerFrame = {
      kind: "attached",
      "chat-id": "c1",
      body: { ok: true },
    };
    const wire = serializeServerFrame(frame);
    expect(JSON.parse(wire)).toEqual(frame);
  });
});

// ─── Bridge behaviour ────────────────────────────────────────────────

// Minimal MetadataStore stand-in. The bridge only consults
// `store.chats.{get, setSessionId, markActive, markInert}` during
// spawn — none of which the unit tests below trigger because they
// inject a stub session directly via the test helper.
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

describe("ClaudeSessionBridge.setPermissionMode (US-004 AC2)", () => {
  test("invokes the SDK Query.setPermissionMode with the chosen mode", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const setPermissionMode = vi.fn().mockResolvedValue(undefined);
    bridge.__test__installStubSession("chat-1", {
      setPermissionMode,
    });

    await bridge.setPermissionMode("chat-1", "plan");

    expect(setPermissionMode).toHaveBeenCalledTimes(1);
    expect(setPermissionMode).toHaveBeenCalledWith("plan");
  });

  test("is a no-op when the chat has no live session (defensive)", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    await expect(
      bridge.setPermissionMode("never-attached", "default" as WirePermissionMode),
    ).resolves.toBeUndefined();
  });
});

describe("ClaudeSessionBridge.submitUserTurnWithPriority (US-004 AC4)", () => {
  test("pushes an SDKUserMessage with the chosen `priority` field onto the input queue", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const captured: Array<{ message: { content: unknown }; priority?: string }> = [];
    bridge.__test__installStubSession("chat-2", {
      capture: (msg) => captured.push(msg as { message: { content: unknown }; priority?: string }),
    });

    bridge.submitUserTurnWithPriority("chat-2", "hello", "next");

    expect(captured).toHaveLength(1);
    expect(captured[0]!.priority).toBe("next");
    expect(captured[0]!.message.content).toBe("hello");
  });

  test("legacy `submitUserTurn` defaults priority to `now` (compat wrapper)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const captured: Array<{ message: { content: unknown }; priority?: string }> = [];
    bridge.__test__installStubSession("chat-3", {
      capture: (msg) => captured.push(msg as { message: { content: unknown }; priority?: string }),
    });

    bridge.submitUserTurn("chat-3", "hi");

    expect(captured).toHaveLength(1);
    expect(captured[0]!.priority).toBe("now");
  });
});
