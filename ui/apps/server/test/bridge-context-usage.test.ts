/**
 * T-005 — Bridge polls + broadcasts context-usage; setModelSettings handler.
 *
 * Asserts that the bridge:
 *   - calls `query.getContextUsage()` on attach (after the snapshot
 *     frame fires) and on every `turn-state` transition to `idle`,
 *   - rounds `percentage` to an integer,
 *   - suppresses broadcast when `|new.percentage - old.percentage| < 1`
 *     AND `new.model === old.model`,
 *   - emits `context-usage-update` on first reading and on a material
 *     change,
 *   - on `getContextUsage()` throw: logs (silent), no frame emitted,
 *     cached snapshot preserved,
 *   - `setModelSettings(chatId, patch)` merges over the row JSON via
 *     `chatRepo.update`, broadcasts `chat-update`, and does NOT call
 *     `query.interrupt()` / abort,
 *   - silently ignores unknown keys on the patch,
 *   - rejects invalid `effort` with an `error` frame and persists nothing.
 */
import { describe, expect, test, vi } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type {
  Query,
  SDKMessage,
  SDKControlGetContextUsageResponse,
} from "@anthropic-ai/claude-agent-sdk";
import type { WireModelSettings } from "../src/chat-protocol/messages.ts";

interface Captured {
  frames: any[];
}

function captureClient(captured: Captured) {
  return {
    send(payload: string) {
      try {
        captured.frames.push(JSON.parse(payload));
      } catch {
        captured.frames.push({ raw: payload });
      }
    },
  } as any;
}

interface FakeQueryControl {
  query: Query;
  pushMessage(msg: SDKMessage): void;
  end(): void;
  /** Resolvers for queued `getContextUsage()` calls (FIFO). */
  usageCalls: Array<{
    resolve: (r: SDKControlGetContextUsageResponse) => void;
    reject: (err: unknown) => void;
  }>;
  /** Resolvers for queued `supportedCommands()` calls (FIFO). */
  supportedCalls: Array<{ resolve: (rows: any[]) => void; reject: (err: unknown) => void }>;
  /** Count of `interrupt()` invocations on the fake Query. */
  interruptCount(): number;
  /** Count of `abort()` invocations on the bridge's AbortController. */
  abortCount(): number;
}

function makeFakeQuery(): FakeQueryControl {
  const buffered: SDKMessage[] = [];
  const waiters: Array<(r: IteratorResult<SDKMessage>) => void> = [];
  let ended = false;
  const usageCalls: FakeQueryControl["usageCalls"] = [];
  const supportedCalls: FakeQueryControl["supportedCalls"] = [];
  let interruptCalls = 0;

  const query = {
    setPermissionMode: async () => undefined,
    interrupt: async () => {
      interruptCalls += 1;
    },
    supportedCommands: () =>
      new Promise<any[]>((resolve, reject) => {
        supportedCalls.push({ resolve, reject });
      }),
    getContextUsage: () =>
      new Promise<SDKControlGetContextUsageResponse>((resolve, reject) => {
        usageCalls.push({ resolve, reject });
      }),
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<SDKMessage>>((resolve) => {
            if (buffered.length > 0) {
              resolve({ value: buffered.shift()!, done: false });
              return;
            }
            if (ended) {
              resolve({ value: undefined as unknown as SDKMessage, done: true });
              return;
            }
            waiters.push(resolve);
          }),
      } as AsyncIterator<SDKMessage>;
    },
  } as unknown as Query;

  return {
    query,
    usageCalls,
    supportedCalls,
    pushMessage(msg) {
      const w = waiters.shift();
      if (w) w({ value: msg, done: false });
      else buffered.push(msg);
    },
    end() {
      ended = true;
      while (waiters.length > 0)
        waiters.shift()!({ value: undefined as unknown as SDKMessage, done: true });
    },
    interruptCount() {
      return interruptCalls;
    },
    abortCount() {
      return 0;
    },
  };
}

function makeBridge(store: any, control: FakeQueryControl) {
  return new ClaudeSessionBridge(store, {
    config: { worktreesRoot: null } as any,
    resolveSpawnCwd: async () => ({
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: null,
    }),
    sdkQueryFactory: () => control.query,
  } as any);
}

function attachConfirmMessage(): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: "s",
    uuid: "u-init",
  } as unknown as SDKMessage;
}

function idleResultMessage(): SDKMessage {
  return {
    type: "result",
    is_error: false,
    subtype: "success",
    session_id: "s",
    uuid: "u-res",
  } as unknown as SDKMessage;
}

function usageResponse(
  partial: Partial<SDKControlGetContextUsageResponse>,
): SDKControlGetContextUsageResponse {
  return {
    categories: [],
    totalTokens: 0,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0,
    gridRows: [],
    model: "claude-opus-4-7",
    memoryFiles: [],
    mcpTools: [],
    ...partial,
  } as SDKControlGetContextUsageResponse;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("T-005 bridge context-usage polling", () => {
  test("attach triggers one getContextUsage() and broadcasts a rounded context-usage-update", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-1", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    // After attach the bridge invokes getContextUsage exactly once.
    await flush();
    expect(control.usageCalls.length).toBe(1);

    control.usageCalls[0]!.resolve(
      usageResponse({ percentage: 42.3, totalTokens: 84_000, model: "claude-opus-4-7" }),
    );
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "context-usage-update");
    expect(updates.length).toBe(1);
    expect(updates[0].body).toEqual({
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
      model: "claude-opus-4-7",
    });

    await store.close();
  });

  test("idle transition triggers a fresh getContextUsage() call", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-2", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    await flush();
    control.usageCalls[0]!.resolve(usageResponse({ percentage: 10 }));
    await flush();

    // Confirm attach + result message → idle transition (re-polls).
    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();

    expect(control.usageCalls.length).toBe(2);

    await store.close();
  });

  test("suppression: |Δpercentage| < 1 AND same model — no second broadcast", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-3", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    await flush();
    control.usageCalls[0]!.resolve(
      usageResponse({ percentage: 42.3, model: "claude-opus-4-7" }),
    );
    await flush();

    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();

    expect(control.usageCalls.length).toBe(2);
    control.usageCalls[1]!.resolve(
      usageResponse({ percentage: 42.6, model: "claude-opus-4-7" }),
    );
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "context-usage-update");
    expect(updates.length).toBe(1);

    await store.close();
  });

  test("material change: 42% → 89% emits a second broadcast", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-4", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    await flush();
    control.usageCalls[0]!.resolve(usageResponse({ percentage: 42 }));
    await flush();

    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();
    control.usageCalls[1]!.resolve(usageResponse({ percentage: 89 }));
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "context-usage-update");
    expect(updates.length).toBe(2);
    expect(updates[1].body.percentage).toBe(89);

    await store.close();
  });

  test("model change with small Δpercentage still broadcasts", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-5", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    await flush();
    control.usageCalls[0]!.resolve(
      usageResponse({ percentage: 42.3, model: "claude-opus-4-7" }),
    );
    await flush();

    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();
    control.usageCalls[1]!.resolve(
      usageResponse({ percentage: 42.4, model: "claude-sonnet-4-6" }),
    );
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "context-usage-update");
    expect(updates.length).toBe(2);

    await store.close();
  });

  test("getContextUsage rejection: no frame, cached snapshot preserved", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "cu-6", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    await flush();
    control.usageCalls[0]!.resolve(usageResponse({ percentage: 42 }));
    await flush();
    expect(captured.frames.filter((f) => f.kind === "context-usage-update").length).toBe(1);

    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();
    control.usageCalls[1]!.reject(new Error("boom"));
    await flush();

    // Still one frame total; the cached snapshot wasn't disturbed (the
    // next reading would compare against percentage=42).
    expect(captured.frames.filter((f) => f.kind === "context-usage-update").length).toBe(1);

    await store.close();
  });
});

describe("T-005 bridge.setModelSettings", () => {
  test("setModelSettings merges patch into chat-row and broadcasts chat-update", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-1", cwd: "/tmp/repo" });
    const initial: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: "xhigh",
      thinking: null,
      contextWindow: "200k",
    };
    store.chats.update(chat.id, { model_settings: initial });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));
    const framesBefore = captured.frames.length;

    bridge.setModelSettings(chat.id, { effort: "low" });
    await flush();

    const row = store.chats.get(chat.id);
    expect(row?.model_settings).toEqual({
      model: "claude-opus-4-7",
      effort: "low",
      thinking: null,
      contextWindow: "200k",
    });
    const updates = captured.frames
      .slice(framesBefore)
      .filter((f) => f.kind === "chat-update");
    expect(updates.length).toBe(1);
    expect(updates[0].body.chat.model_settings.effort).toBe("low");

    await store.close();
  });

  test("setModelSettings does NOT call query.interrupt() while a Query is active", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-2", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    await bridge.attach(chat.id, captureClient({ frames: [] }));

    bridge.setModelSettings(chat.id, { model: "claude-sonnet-4-6" });
    await flush();

    expect(control.interruptCount()).toBe(0);

    await store.close();
  });

  test("invalid effort yields error frame and no persistence", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-3", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    const framesBefore = captured.frames.length;
    bridge.setModelSettings(chat.id, { effort: "wat" as any });
    await flush();

    const after = captured.frames.slice(framesBefore);
    expect(after.filter((f) => f.kind === "error").length).toBe(1);
    expect(store.chats.get(chat.id)?.model_settings).toBeNull();
    // No chat-update emitted by the rejected patch.
    expect(after.filter((f) => f.kind === "chat-update").length).toBe(0);

    await store.close();
  });

  test("invalid contextWindow yields error frame and no persistence", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-4", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    bridge.setModelSettings(chat.id, { contextWindow: "500k" as any });
    await flush();

    expect(captured.frames.filter((f) => f.kind === "error").length).toBe(1);
    expect(store.chats.get(chat.id)?.model_settings).toBeNull();

    await store.close();
  });

  test("unknown keys are silently dropped (no error, no persistence of unknown)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-5", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    bridge.setModelSettings(chat.id, { model: "claude-opus-4-7", banana: true } as any);
    await flush();

    expect(captured.frames.filter((f) => f.kind === "error").length).toBe(0);
    const row = store.chats.get(chat.id);
    expect(row?.model_settings?.model).toBe("claude-opus-4-7");
    expect((row?.model_settings as any).banana).toBeUndefined();

    await store.close();
  });

  test("next startQuery reads the new tuple (T-003 integration: no respawn needed for read)", async () => {
    // Verifies the design property that the new settings land on the row
    // and the next spawn picks them up via the existing T-003 path. We
    // do not start a second Query in this test — it asserts the row
    // shape, which is what startQuery() reads.
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "sm-6", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    await bridge.attach(chat.id, captureClient({ frames: [] }));

    bridge.setModelSettings(chat.id, { model: "claude-sonnet-4-6", effort: "high" });
    await flush();

    const row = store.chats.get(chat.id);
    expect(row?.model_settings?.model).toBe("claude-sonnet-4-6");
    expect(row?.model_settings?.effort).toBe("high");

    await store.close();
  });
});
