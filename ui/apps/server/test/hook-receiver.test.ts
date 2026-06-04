import { describe, test, expect } from "vitest";
import { normalizeHookEvent } from "../src/hook-receiver/normalize.ts";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import {
  mountHookReceiver,
  setEnvelopeBroadcaster,
} from "../src/hook-receiver/index.ts";
import { createPermissionGate } from "../src/hook-receiver/permission-gate.ts";

/** Flush pending microtasks/timers so the route handler reaches register(). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("normalizeHookEvent", () => {
  test("PermissionRequest (legacy) yields pending-gate", () => {
    const r = normalizeHookEvent({ channel: "PermissionRequest", chatId: "c1", payload: { tool: "Bash" } });
    expect(r.pendingGate?.kind).toBe("permissionrequest");
    expect(r.envelopes[0].kind).toBe("gate-pending");
  });

  test("AskUserQuestion via PreToolUse yields pending-gate", () => {
    // Real Claude Code emits AskUserQuestion as a PreToolUse — interception
    // at PostToolUse is too late (user already answered in the TUI).
    const r = normalizeHookEvent({
      channel: "PreToolUse",
      chatId: "c1",
      toolName: "AskUserQuestion",
      payload: {
        question: "Pick one",
        options: [{ label: "yes" }, { label: "no" }],
      },
    });
    expect(r.pendingGate?.kind).toBe("askuserquestion");
    expect(r.envelopes[0].kind).toBe("gate-pending");
    const data = (r.envelopes[0].body as { data: { options: Array<{ id: string }> } }).data;
    expect(data.options.map((o) => o.id)).toEqual(["opt-1", "opt-2"]);
    // AskUserQuestion now also blocks the agent at the hook: the gate id is
    // the question id, so the WS question-response resolves the right hold.
    expect(r.gate).toEqual({ chatId: "c1", id: (data as { id: string }).id });
  });

  test("Stop clears gates", () => {
    const r = normalizeHookEvent({ channel: "Stop", chatId: "c1" });
    expect(r.clearGates?.chatId).toBe("c1");
  });

  test("unknown channel is forward-compat with warning", () => {
    const r = normalizeHookEvent({ channel: "SomeFutureChannel", chatId: "c1", payload: {} });
    expect(r.warning).toBeTruthy();
    expect(r.envelopes[0].kind).toBe("hook-passthrough");
  });
});

describe("mountHookReceiver route logic", () => {
  test("two consecutive PermissionRequests = one row, latest data wins", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountHookReceiver(routes, store);

    // POST 1
    const r1 = await routes["/hooks/event"](
      new Request("http://localhost/hooks/event", {
        method: "POST",
        body: JSON.stringify({ channel: "PermissionRequest", chatId: "c1", payload: { v: 1 } }),
      }),
    );
    expect(r1.status).toBe(200);

    // POST 2
    const r2 = await routes["/hooks/event"](
      new Request("http://localhost/hooks/event", {
        method: "POST",
        body: JSON.stringify({ channel: "PermissionRequest", chatId: "c1", payload: { v: 2 } }),
      }),
    );
    expect(r2.status).toBe(200);

    expect(store.pendingGates.list().length).toBe(1);
    expect(store.pendingGates.get("c1", "permissionrequest")?.data?.v).toBe(2);
    await store.close();
  });

  test("gated PreToolUse holds the response open until the gate resolves, then returns the decision", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const gate = createPermissionGate();
    const routes: Record<string, any> = {};
    const captured: any[] = [];
    setEnvelopeBroadcaster((env) => captured.push(env));
    mountHookReceiver(routes, store, undefined, gate);
    try {
      // Fire the hook but do NOT await yet — it must block on the gate.
      const respPromise = routes["/hooks/event"](
        new Request("http://localhost/hooks/event", {
          method: "POST",
          body: JSON.stringify({
            hook_event_name: "PreToolUse",
            chatId: "c-1",
            tool_name: "Bash",
            permission_mode: "default",
            tool_input: { id: "perm-block-1", command: "ls" },
          }),
        }),
      ) as Promise<Response>;
      await tick();

      // The popup envelope was broadcast and a gate is pending.
      const preToolUse = captured.find((e) => e.kind === "pre-tool-use");
      expect(preToolUse).toBeDefined();
      expect(preToolUse.body.payload.id).toBe("perm-block-1");
      expect(gate.pendingCount("c-1")).toBe(1);

      // Now answer in the "UI": resolve the gate.
      expect(gate.resolve("c-1", "perm-block-1", { decision: "allow", reason: "ok" })).toBe(true);

      const resp = await respPromise;
      expect(resp.status).toBe(200);
      const decision = JSON.parse(await resp.text());
      expect(decision).toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "ok",
        },
      });
      expect(gate.pendingCount("c-1")).toBe(0);
    } finally {
      setEnvelopeBroadcaster(null);
      await store.close();
    }
  });

  test("Stop releases held gates for the chat (rejectAll)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const gate = createPermissionGate();
    const routes: Record<string, any> = {};
    setEnvelopeBroadcaster(() => {});
    mountHookReceiver(routes, store, undefined, gate);
    try {
      const respPromise = routes["/hooks/event"](
        new Request("http://localhost/hooks/event", {
          method: "POST",
          body: JSON.stringify({
            hook_event_name: "PreToolUse",
            chatId: "c-1",
            tool_name: "Bash",
            permission_mode: "default",
            tool_input: { id: "perm-orphan", command: "ls" },
          }),
        }),
      ) as Promise<Response>;
      await tick();
      expect(gate.pendingCount("c-1")).toBe(1);

      // Turn ends before the user answers — the held curl must be released.
      await routes["/hooks/event"](
        new Request("http://localhost/hooks/event", {
          method: "POST",
          body: JSON.stringify({ hook_event_name: "Stop", chatId: "c-1" }),
        }),
      );

      const decision = JSON.parse(await (await respPromise).text());
      expect(decision.hookSpecificOutput.permissionDecision).toBe("defer");
      expect(gate.pendingCount("c-1")).toBe(0);
    } finally {
      setEnvelopeBroadcaster(null);
      await store.close();
    }
  });

  test("Stop with no pending is a no-op (no error)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, any> = {};
    mountHookReceiver(routes, store);
    const r = await routes["/hooks/event"](
      new Request("http://localhost/hooks/event", {
        method: "POST",
        body: JSON.stringify({ channel: "Stop", chatId: "c1" }),
      }),
    );
    expect(r.status).toBe(200);
    expect(store.pendingGates.list().length).toBe(0);
    await store.close();
  });
});
