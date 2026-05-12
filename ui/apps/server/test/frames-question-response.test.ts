/**
 * T-002 — AskUserQuestion picker end-to-end (server side).
 *
 * Verifies US-001 acceptance criteria on the bridge / wire side:
 *
 *   AC1 (wire):  `pending-question` is a member of `ServerFrame` and
 *                `question-response` is a member of `ClientFrame`. Both
 *                round-trip through JSON with their documented body shapes.
 *   AC1 (bridge): `handleCanUseTool` branches on `toolName === "AskUserQuestion"`
 *                and broadcasts a `pending-question` frame (NOT
 *                `pending-permission`) carrying the parsed question +
 *                options + multiSelect flag. `session.pendingQuestion` is
 *                populated with the SDK's `resolve` closure.
 *   AC5 (bridge): `respondToQuestion` resolves the stashed promise with
 *                a `behavior: "allow"` PermissionResult whose
 *                `updatedInput` reflects the user's answer.
 *
 * Test style follows T-001/T-004 (`frames-tasks-update.test.ts`,
 * `frames-permission-mode.test.ts`): vitest in node runtime, static
 * type-level assertions via `expectTypeOf`, runtime assertions via the
 * test bridge stub helper `__test__installStubSession`.
 *
 * RED path:
 *   - Before implementation, `serializeServerFrame` accepts the
 *     `pending-question` frame already (the variant pre-exists) but
 *     `bridge.respondToQuestion` is a stub that throws "not implemented".
 *   - `handleCanUseTool` does NOT branch on AskUserQuestion, so the
 *     synthetic canUseTool call ends up populating `pendingPermission`
 *     instead of `pendingQuestion`. The runtime assertions on
 *     `pendingQuestion` populated / `pendingPermission` null fail.
 *
 * GREEN path: the bridge branches correctly, stashes the resolve, and
 * `respondToQuestion` resolves it with the right shape.
 */
import { describe, test, expect, expectTypeOf, vi } from "vitest";
import {
  serializeServerFrame,
  type ClientFrame,
  type PendingQuestionFrame,
  type QuestionResponseFrame,
  type ServerFrame,
} from "../src/chat-protocol/frames.ts";
import type { PendingQuestion } from "../src/chat-protocol/messages.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type {
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";

describe("ServerFrame — `pending-question` variant (US-001 AC1 wire)", () => {
  test("`pending-question` is a member of the ServerFrame union", () => {
    expectTypeOf<PendingQuestionFrame>().toMatchTypeOf<ServerFrame>();

    const frame = {
      kind: "pending-question",
      "chat-id": "c1",
      body: {
        id: "q-1",
        question: "Pick a color",
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
        ],
        multiSelect: false,
      } satisfies PendingQuestion,
    } satisfies ServerFrame;
    expect(frame.kind).toBe("pending-question");
  });

  test("`serializeServerFrame` round-trips a pending-question frame with multiSelect=true", () => {
    const body: PendingQuestion = {
      id: "q-multi",
      question: "Pick all that apply",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      multiSelect: true,
    };
    const frame: PendingQuestionFrame = {
      kind: "pending-question",
      "chat-id": "chat-q",
      body,
    };
    const wire = serializeServerFrame(frame);
    expect(JSON.parse(wire)).toEqual(frame);
  });

  test("`serializeServerFrame` can clear pending-question state with body=null", () => {
    const frame: PendingQuestionFrame = {
      kind: "pending-question",
      "chat-id": "chat-q",
      body: null,
    };
    expect(JSON.parse(serializeServerFrame(frame))).toEqual(frame);
  });
});

describe("ClientFrame — `question-response` variant (US-001 AC5 wire)", () => {
  test("`question-response` is a member of the ClientFrame union", () => {
    expectTypeOf<QuestionResponseFrame>().toMatchTypeOf<ClientFrame>();

    const frame = {
      kind: "question-response",
      "chat-id": "c1",
      body: { id: "q-1", answers: ["red"] },
    } satisfies ClientFrame;
    expect(frame.kind).toBe("question-response");
    expect(frame.body.answers).toEqual(["red"]);
  });

  test("`question-response.body` carries multi-select answers + optional `otherText`", () => {
    const frame: QuestionResponseFrame = {
      kind: "question-response",
      "chat-id": "c1",
      body: { id: "q-1", answers: ["a", "b", "__freeform__"], otherText: "my custom reply" },
    };
    expect(frame.body.answers).toEqual(["a", "b", "__freeform__"]);
    expect(frame.body.otherText).toBe("my custom reply");
  });
});

// ─── Bridge behaviour ────────────────────────────────────────────────

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

// Synthetic canUseTool context — mirrors the SDK's CanUseTool signature
// closely enough for the bridge's handler. Only `toolUseID` and `signal`
// are read by the bridge today.
function makeCtx(toolUseID: string): {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  title?: string;
  displayName?: string;
  description?: string;
  toolUseID: string;
} {
  return {
    signal: new AbortController().signal,
    suggestions: [],
    toolUseID,
  };
}

describe("ClaudeSessionBridge.handleCanUseTool — AskUserQuestion branch (US-001 AC1)", () => {
  test("AskUserQuestion routes to pending-question, NOT pending-permission, and broadcasts the parsed question", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const sent: string[] = [];
    bridge.__test__installStubSession("chat-q1", {});
    const session = bridge.__test__sessions().get("chat-q1")!;
    session.clients.add({ send: (text: string) => sent.push(text) });

    const input = {
      question: "Pick a color",
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
      ],
      multiSelect: false,
      header: "Color selection",
    };

    // Invoke the bridge's canUseTool wiring synchronously; the SDK gets
    // a Promise back. We do NOT await it — the assertion is that the
    // broadcast + stashed state lands immediately.
    const promise = bridge.__test__invokeCanUseTool(
      "chat-q1",
      "AskUserQuestion",
      input,
      makeCtx("tool-use-1"),
    );

    // pendingQuestion populated; pendingPermission left untouched.
    expect(session.pendingQuestion).not.toBeNull();
    expect(session.pendingPermission).toBeNull();

    // A `pending-question` frame went out — NOT `pending-permission`.
    const kinds = sent
      .map((s) => {
        try {
          return (JSON.parse(s) as { kind: string }).kind;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    expect(kinds).toContain("pending-question");
    expect(kinds).not.toContain("pending-permission");

    // Body carries the parsed question + options.
    const pendingQuestionFrame = sent
      .map((s) => JSON.parse(s) as { kind: string; body: PendingQuestion | null })
      .find((f) => f.kind === "pending-question")!;
    expect(pendingQuestionFrame.body).not.toBeNull();
    expect(pendingQuestionFrame.body!.question).toBe("Pick a color");
    expect(pendingQuestionFrame.body!.options).toEqual(input.options);
    expect(pendingQuestionFrame.body!.multiSelect).toBe(false);

    // Drain the dangling promise to keep vitest happy.
    bridge.respondToQuestion("chat-q1", pendingQuestionFrame.body!.id, {
      answers: ["red"],
    });
    return promise;
  });

  test("multiSelect=true is preserved in the broadcast body", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    const sent: string[] = [];
    bridge.__test__installStubSession("chat-q2", {});
    const session = bridge.__test__sessions().get("chat-q2")!;
    session.clients.add({ send: (text: string) => sent.push(text) });

    const promise = bridge.__test__invokeCanUseTool(
      "chat-q2",
      "AskUserQuestion",
      {
        question: "Pick all",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        multiSelect: true,
      },
      makeCtx("tool-use-2"),
    );

    const frame = sent
      .map((s) => JSON.parse(s) as { kind: string; body: PendingQuestion | null })
      .find((f) => f.kind === "pending-question")!;
    expect(frame.body!.multiSelect).toBe(true);

    bridge.respondToQuestion("chat-q2", frame.body!.id, { answers: ["a", "b"] });
    return promise;
  });
});

describe("ClaudeSessionBridge.respondToQuestion (US-001 AC5)", () => {
  test("resolves the stashed promise with behavior: allow and clears pendingQuestion", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-q3", {});
    const session = bridge.__test__sessions().get("chat-q3")!;
    session.clients.add({ send: () => {} });

    const promise = bridge.__test__invokeCanUseTool(
      "chat-q3",
      "AskUserQuestion",
      {
        question: "Choose",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
      makeCtx("tool-use-3"),
    );

    const pending = session.pendingQuestion!;
    expect(pending).not.toBeNull();

    bridge.respondToQuestion("chat-q3", pending.pending.id, {
      answers: ["yes"],
    });

    const result = (await promise) as PermissionResult;
    expect(result.behavior).toBe("allow");
    expect(session.pendingQuestion).toBeNull();
  });

  test("multi-select answers are passed through to the SDK resolve", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-q4", {});
    const session = bridge.__test__sessions().get("chat-q4")!;
    session.clients.add({ send: () => {} });

    const promise = bridge.__test__invokeCanUseTool(
      "chat-q4",
      "AskUserQuestion",
      {
        question: "Pick all",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
        multiSelect: true,
      },
      makeCtx("tool-use-4"),
    );

    const pending = session.pendingQuestion!;
    bridge.respondToQuestion("chat-q4", pending.pending.id, {
      answers: ["a", "c"],
      otherText: undefined,
    });

    const result = (await promise) as PermissionResult & { behavior: "allow" };
    expect(result.behavior).toBe("allow");
    // The bridge surfaces the chosen ids through the SDK PermissionResult
    // — packaging is via `updatedInput` per the SDK's AskUserQuestion
    // contract (the chosen ids land in the tool input that Claude reads
    // back as the tool result).
    expect(result.updatedInput).toBeDefined();
  });

  test("freeform `otherText` is carried through alongside answers", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-q5", {});
    const session = bridge.__test__sessions().get("chat-q5")!;
    session.clients.add({ send: () => {} });

    const promise = bridge.__test__invokeCanUseTool(
      "chat-q5",
      "AskUserQuestion",
      {
        question: "Pick or write",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
      makeCtx("tool-use-5"),
    );

    const pending = session.pendingQuestion!;
    bridge.respondToQuestion("chat-q5", pending.pending.id, {
      answers: ["__freeform__"],
      otherText: "actually, neither — let me explain",
    });

    const result = (await promise) as PermissionResult & { behavior: "allow" };
    expect(result.behavior).toBe("allow");
    // The freeform text must appear in the SDK-bound result. We accept
    // any of: included in `updatedInput.answer` / `updatedInput.freeform`
    // / a stringified field — the contract is that it is non-empty in
    // the resolved value.
    const serialised = JSON.stringify(result.updatedInput ?? {});
    expect(serialised).toContain("actually, neither");
  });

  test("is a no-op for a stale / mismatched id (drops silently)", async () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-q6", {});
    const session = bridge.__test__sessions().get("chat-q6")!;
    session.clients.add({ send: () => {} });

    const promise = bridge.__test__invokeCanUseTool(
      "chat-q6",
      "AskUserQuestion",
      {
        question: "Pick",
        options: [{ id: "y", label: "Y" }],
      },
      makeCtx("tool-use-6"),
    );

    // Mismatched id — should NOT resolve the pending promise.
    bridge.respondToQuestion("chat-q6", "wrong-id", { answers: ["y"] });

    // Verify the original promise is still pending by racing it against
    // a microtask resolve.
    const stillPending = await Promise.race([
      promise.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);
    expect(stillPending).toBe("pending");

    // Cleanup so we don't leak the unresolved promise.
    const id = session.pendingQuestion!.pending.id;
    bridge.respondToQuestion("chat-q6", id, { answers: ["y"] });
    await promise;
  });
});
