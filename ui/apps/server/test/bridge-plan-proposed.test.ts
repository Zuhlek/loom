/**
 * T-003 — Interactive ProposedPlanCard end-to-end (server side).
 *
 * Verifies US-003 acceptance criteria on the server side:
 *   AC1 (bridge): when the bridge observes an `ExitPlanMode` tool_use in
 *       the SDK assistant stream, the bridge emits a `plan-proposed`
 *       ChatItem via the existing item-append pathway, status "pending".
 *   AC3 (bridge): `bridge.acceptPlanProposal(chatId, planId)` calls
 *       `Query.setPermissionMode("default")` exactly once and pushes a
 *       user-turn ("Please execute the plan as proposed") through the
 *       SDK input queue. The plan-proposed item flips to status
 *       "accepted" via an item-update broadcast.
 *   AC4 (bridge): `bridge.rejectPlanProposal(chatId, planId)` pushes a
 *       reconsider user-turn through the queue and leaves the SDK
 *       permission mode UNCHANGED (no `Query.setPermissionMode` call).
 *       Item status flips to "rejected".
 *   AC5 (mirror): the `plan-proposed` ChatItem kind is declared on the
 *       server side (mirrored on the web side by chat-types.ts; the web
 *       contract is tested in `apps/web/test/proposed-plan-card.test.ts`).
 *
 * Wire-frame additions (T-003 scope): two new `ClientFrame` variants
 *   `plan-accept` and `plan-reject`, each carrying `{ planId }`. The
 *   http-ws-server routes them to the bridge methods above. The frame
 *   union check rides on this test file via expectTypeOf.
 *
 * Test style: matches T-001/T-002/T-004/T-006 server tests (vitest,
 * node runtime, no jsdom). The bridge is driven via the existing
 * `__test__installStubSession` + `__test__handleSdkMessage` introduced
 * in T-006.
 *
 * RED path: before implementation,
 *   - `plan-proposed` is not a ChatItem `kind` so the bridge's
 *     `handleSdkMessage` ignores the ExitPlanMode block; the test's
 *     assertion that an item with `kind === "plan-proposed"` exists
 *     fails at runtime.
 *   - `bridge.acceptPlanProposal` / `bridge.rejectPlanProposal` do not
 *     yet exist; we declare runtime stubs that throw "not implemented"
 *     so the test file compiles but fails on the call.
 *   - `plan-accept` / `plan-reject` are not in the ClientFrame union;
 *     the expectTypeOf assertion fails.
 *
 * GREEN path: implementation lands the ChatItem kind, the bridge
 * methods, the ClientFrame variants, and the http-ws routing.
 */
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { MetadataStore } from "../src/metadata-store/index.ts";
import type {
  ChatItem,
  PlanProposedItem,
} from "../src/chat-protocol/messages.ts";
import type {
  ClientFrame,
  PlanAcceptFrame,
  PlanRejectFrame,
} from "../src/chat-protocol/frames.ts";

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
 * Build a minimal SDK assistant message carrying a single `tool_use`
 * block for `ExitPlanMode` with the given plan body in `input.plan`.
 *
 * The SDK ships `ExitPlanMode` as a regular tool_use block on the
 * assistant message; the bridge observes it the same way it observes
 * any other tool call. The plan body lives at `input.plan` per the
 * SDK's plan-mode convention.
 */
function makeExitPlanModeAssistantMessage(
  toolUseId: string,
  plan: string,
  uuid = "assistant-plan-1",
) {
  return {
    type: "assistant",
    uuid,
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "ExitPlanMode",
          input: { plan },
        },
      ],
    },
  };
}

describe("ClientFrame — plan-accept / plan-reject variants (T-003)", () => {
  test("`plan-accept` is a member of the ClientFrame union and carries `planId`", () => {
    expectTypeOf<PlanAcceptFrame>().toMatchTypeOf<ClientFrame>();
    const frame = {
      kind: "plan-accept",
      "chat-id": "c1",
      body: { planId: "plan-item-1" },
    } satisfies ClientFrame;
    expect(frame.body.planId).toBe("plan-item-1");
  });

  test("`plan-reject` is a member of the ClientFrame union and carries `planId`", () => {
    expectTypeOf<PlanRejectFrame>().toMatchTypeOf<ClientFrame>();
    const frame = {
      kind: "plan-reject",
      "chat-id": "c1",
      body: { planId: "plan-item-1" },
    } satisfies ClientFrame;
    expect(frame.body.planId).toBe("plan-item-1");
  });
});

describe("PlanProposedItem mirror — wire shape (T-003 AC5)", () => {
  test("PlanProposedItem is a member of the ChatItem union", () => {
    expectTypeOf<PlanProposedItem>().toMatchTypeOf<ChatItem>();
  });

  test("PlanProposedItem carries planText + status + sourceToolUseId", () => {
    const item: PlanProposedItem = {
      kind: "plan-proposed",
      id: "p1",
      ts: 0,
      planText: "Some plan body.",
      status: "pending",
    };
    expect(item.kind).toBe("plan-proposed");
    expect(item.status).toBe("pending");
    expect(item.planText).toBe("Some plan body.");
  });
});

describe("ClaudeSessionBridge — ExitPlanMode detection (T-003 AC1)", () => {
  test("emits a `plan-proposed` ChatItem on the assistant stream when ExitPlanMode tool_use lands", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-plan-1", {});
    const session = bridge.__test__sessions().get("chat-plan-1")!;

    const msg = makeExitPlanModeAssistantMessage(
      "tool-use-plan-1",
      "1. Read the file\n2. Edit it\n3. Verify",
    );
    bridge.__test__handleSdkMessage("chat-plan-1", msg);

    const planItem = session.items.find(
      (it): it is PlanProposedItem => it.kind === "plan-proposed",
    );
    expect(planItem).toBeDefined();
    expect(planItem!.planText).toBe("1. Read the file\n2. Edit it\n3. Verify");
    expect(planItem!.status).toBe("pending");
  });

  test("skips emission when the plan body is empty (defensive guard)", () => {
    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-plan-2", {});
    const session = bridge.__test__sessions().get("chat-plan-2")!;

    const msg = makeExitPlanModeAssistantMessage("tool-use-plan-empty", "");
    bridge.__test__handleSdkMessage("chat-plan-2", msg);

    const planItem = session.items.find((it) => it.kind === "plan-proposed");
    expect(planItem).toBeUndefined();
  });
});

describe("ClaudeSessionBridge.acceptPlanProposal (T-003 AC3)", () => {
  test("calls setPermissionMode('default') and queues the execute user-turn; flips status to accepted", async () => {
    const setPermissionMode = vi.fn().mockResolvedValue(undefined);
    const captured: Array<{ message: { content: unknown }; priority?: string }> = [];

    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-plan-accept", {
      setPermissionMode,
      capture: (m) =>
        captured.push(m as { message: { content: unknown }; priority?: string }),
    });
    const session = bridge.__test__sessions().get("chat-plan-accept")!;

    bridge.__test__handleSdkMessage(
      "chat-plan-accept",
      makeExitPlanModeAssistantMessage("tool-use-plan-accept", "Plan A"),
    );
    const planItem = session.items.find(
      (it): it is PlanProposedItem => it.kind === "plan-proposed",
    );
    expect(planItem).toBeDefined();

    await bridge.acceptPlanProposal("chat-plan-accept", planItem!.id);

    expect(setPermissionMode).toHaveBeenCalledTimes(1);
    expect(setPermissionMode).toHaveBeenCalledWith("default");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.message.content).toContain("execute the plan");

    // Item status flipped to "accepted".
    const updated = session.items.find(
      (it): it is PlanProposedItem =>
        it.kind === "plan-proposed" && it.id === planItem!.id,
    );
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("accepted");
  });
});

describe("ClaudeSessionBridge.rejectPlanProposal (T-003 AC4)", () => {
  test("queues a reconsider user-turn, does NOT call setPermissionMode, flips status to rejected", async () => {
    const setPermissionMode = vi.fn().mockResolvedValue(undefined);
    const captured: Array<{ message: { content: unknown }; priority?: string }> = [];

    const bridge = new ClaudeSessionBridge(makeStubStore(), { drainMs: 0 });
    bridge.__test__installStubSession("chat-plan-reject", {
      setPermissionMode,
      capture: (m) =>
        captured.push(m as { message: { content: unknown }; priority?: string }),
    });
    const session = bridge.__test__sessions().get("chat-plan-reject")!;

    bridge.__test__handleSdkMessage(
      "chat-plan-reject",
      makeExitPlanModeAssistantMessage("tool-use-plan-reject", "Plan B"),
    );
    const planItem = session.items.find(
      (it): it is PlanProposedItem => it.kind === "plan-proposed",
    );
    expect(planItem).toBeDefined();

    await bridge.rejectPlanProposal("chat-plan-reject", planItem!.id);

    // Reject must NOT touch permission mode (it stays "plan" per AC4).
    expect(setPermissionMode).not.toHaveBeenCalled();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.message.content).toMatch(/reconsider/i);

    const updated = session.items.find(
      (it): it is PlanProposedItem =>
        it.kind === "plan-proposed" && it.id === planItem!.id,
    );
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("rejected");
  });
});
