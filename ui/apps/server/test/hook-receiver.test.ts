import { describe, test, expect } from "vitest";
import { normalizeHookEvent } from "../src/hook-receiver/normalize.ts";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountHookReceiver } from "../src/hook-receiver/index.ts";

describe("normalizeHookEvent", () => {
  test("PermissionRequest yields pending-gate", () => {
    const r = normalizeHookEvent({ channel: "PermissionRequest", chatId: "c1", payload: { tool: "Bash" } });
    expect(r.pendingGate?.kind).toBe("permissionrequest");
    expect(r.envelopes[0].kind).toBe("gate-pending");
  });

  test("AskUserQuestion via PostToolUse yields pending-gate", () => {
    const r = normalizeHookEvent({
      channel: "PostToolUse",
      chatId: "c1",
      toolName: "AskUserQuestion",
      payload: { questions: [{}] },
    });
    expect(r.pendingGate?.kind).toBe("askuserquestion");
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
    const store = await initMetadataStore();
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

  test("Stop with no pending is a no-op (no error)", async () => {
    const store = await initMetadataStore();
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
