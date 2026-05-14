/**
 * T-015 — Bridge integration smoke (server scenario).
 *
 * End-to-end happy-path walk across the bridge surface:
 *
 *   1. Spawn for a chat with NULL `model_settings` ⇒ SDK `Options` omits
 *      `model`, `effort`, `thinking`, `betas`.
 *   2. `setModelSettings` mid-attach with `{ model, effort, contextWindow:
 *      '1m' }` ⇒ chat-row updated; the active `Query` is NOT aborted
 *      (US-009 AC1); `chat-update` frame broadcast so attached clients
 *      refresh pill labels.
 *   3. Detach + re-attach to force a fresh `startQuery()` ⇒ SDK `Options`
 *      now carries `model`, `effort: 'xhigh'`, and `betas:
 *      ['context-1m-2025-08-07']` (US-007 AC3 + US-008 AC3).
 *   4. Plugin reload (`plugin_install` system message) ⇒ bridge re-fires
 *      `query.supportedCommands()` and broadcasts a second
 *      `slash-commands-update` (US-006 AC2).
 *   5. Turn-idle (a `result` SDK message) ⇒ bridge invokes
 *      `query.getContextUsage()` and broadcasts a `context-usage-update`
 *      (US-005 AC2).
 *
 * Each step touches at least one US-001..US-009 acceptance criterion;
 * the suite catalogues coverage as inline comments per assertion.
 *
 * Test seam: the `sdkQueryFactory` injection captures the `Options`
 * passed to the SDK `query()` factory on each spawn; the rest of the
 * bridge runs through its real `attach()` → SDK message loop, the same
 * pattern as `bridge-slash-commands.test.ts`,
 * `bridge-context-usage.test.ts`, and `bridge-model-settings-options.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import {
  ClaudeSessionBridge,
  classifySlashCommand,
  SKILL_NAMES,
} from "../src/process-manager/claude-session-bridge.ts";
import type {
  Query,
  SDKMessage,
  SlashCommand,
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
  supportedCalls: Array<{
    resolve: (rows: SlashCommand[]) => void;
    reject: (err: unknown) => void;
  }>;
  usageCalls: Array<{
    resolve: (r: SDKControlGetContextUsageResponse) => void;
    reject: (err: unknown) => void;
  }>;
  interruptCount(): number;
}

function makeFakeQuery(): FakeQueryControl {
  const buffered: SDKMessage[] = [];
  const waiters: Array<(r: IteratorResult<SDKMessage>) => void> = [];
  let ended = false;
  const supportedCalls: FakeQueryControl["supportedCalls"] = [];
  const usageCalls: FakeQueryControl["usageCalls"] = [];
  let interruptCalls = 0;

  const query = {
    setPermissionMode: async () => undefined,
    interrupt: async () => {
      interruptCalls += 1;
    },
    supportedCommands: () =>
      new Promise<SlashCommand[]>((resolve, reject) => {
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
    supportedCalls,
    usageCalls,
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
  };
}

interface CapturedOptions {
  options: any[];
}

function makeBridge(store: any, control: FakeQueryControl, captured: CapturedOptions) {
  return new ClaudeSessionBridge(store, {
    config: { worktreesRoot: null } as any,
    resolveSpawnCwd: async () => ({
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: null,
    }),
    sdkQueryFactory: ({ options }: { prompt: any; options: any }) => {
      captured.options.push(options);
      return control.query;
    },
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

function pluginInstallCompleted(): SDKMessage {
  return {
    type: "system",
    subtype: "plugin_install",
    status: "completed",
    name: "newskill",
    uuid: "u-plug",
    session_id: "s",
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

describe("T-015 server smoke — end-to-end bridge happy path", () => {
  test("step 1 (US-007 AC5 + US-008 AC5): NULL model_settings ⇒ Options omits model/effort/thinking/betas", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-1", cwd: "/tmp/repo" });
    expect(store.chats.get(chat.id)?.model_settings).toBeNull();
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    const framesCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(framesCaptured));

    expect(optsCaptured.options.length).toBe(1);
    const opts = optsCaptured.options[0];
    expect(opts.model).toBeUndefined();
    expect(opts.effort).toBeUndefined();
    expect(opts.thinking).toBeUndefined();
    expect(opts.betas).toBeUndefined();

    await store.close();
  });

  test("step 2 (US-007 AC1+AC2, US-008 AC1+AC2, US-009 AC1): setModelSettings persists + does NOT abort", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-2", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    const framesCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(framesCaptured));

    const framesBefore = framesCaptured.frames.length;
    bridge.setModelSettings(chat.id, {
      model: "claude-opus-4-7",
      effort: "xhigh",
      contextWindow: "1m",
    });
    await flush();

    // US-007 AC2 / US-008 AC2: chat-row persisted with the patch values.
    const row = store.chats.get(chat.id);
    expect(row?.model_settings?.model).toBe("claude-opus-4-7");
    expect(row?.model_settings?.effort).toBe("xhigh");
    expect(row?.model_settings?.contextWindow).toBe("1m");

    // US-009 AC1: active Query NOT interrupted by the patch.
    expect(control.interruptCount()).toBe(0);

    // US-009 AC3: chat-update broadcast lets the UI refresh pill labels.
    const after = framesCaptured.frames.slice(framesBefore);
    const chatUpdates = after.filter((f) => f.kind === "chat-update");
    expect(chatUpdates.length).toBe(1);
    expect(chatUpdates[0].body.chat.model_settings.model).toBe("claude-opus-4-7");

    await store.close();
  });

  test("step 3 (US-007 AC3, US-008 AC3): next spawn carries model + effort='xhigh' + betas=['context-1m-2025-08-07']", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-3", cwd: "/tmp/repo" });
    const persisted: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: "xhigh",
      thinking: null,
      contextWindow: "1m",
    };
    store.chats.update(chat.id, { model_settings: persisted });
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    await bridge.attach(chat.id, captureClient({ frames: [] }));

    expect(optsCaptured.options.length).toBe(1);
    const opts = optsCaptured.options[0];
    expect(opts.model).toBe("claude-opus-4-7");
    expect(opts.effort).toBe("xhigh");
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
    // contextWindow itself is bridge-internal and NOT mirrored onto Options.
    expect(opts.contextWindow).toBeUndefined();

    await store.close();
  });

  test("step 4 (US-001, US-002, US-006 AC1+AC2): supportedCommands + plugin_install re-fire ⇒ two slash-commands-update broadcasts", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-4", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    const framesCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(framesCaptured));

    // First enumeration fires after the first non-error SDK message.
    control.pushMessage(attachConfirmMessage());
    await flush();
    expect(control.supportedCalls.length).toBe(1);
    control.supportedCalls[0]!.resolve([
      { name: "weave", description: "weave d", argumentHint: "" } as SlashCommand,
      { name: "idea", description: "idea d", argumentHint: "" } as SlashCommand,
      { name: "forge", description: "forge d", argumentHint: "" } as SlashCommand,
      { name: "tune", description: "tune d", argumentHint: "" } as SlashCommand,
      // US-001 AC5: built-in collision suppressed client-side.
      { name: "plan", description: "sdk plan", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    const firstUpdates = framesCaptured.frames.filter(
      (f) => f.kind === "slash-commands-update",
    );
    expect(firstUpdates.length).toBe(1);
    // US-002 AC1: each row carries a `kind` discriminator.
    const wireCommands = firstUpdates[0].body.commands;
    expect(wireCommands.find((c: any) => c.name === "weave")?.kind).toBe("skill");
    expect(wireCommands.find((c: any) => c.name === "idea")?.kind).toBe("skill");
    expect(wireCommands.find((c: any) => c.name === "forge")?.kind).toBe("skill");
    expect(wireCommands.find((c: any) => c.name === "tune")?.kind).toBe("skill");
    expect(wireCommands.find((c: any) => c.name === "plan")?.kind).toBe("command");

    // US-006 AC2: plugin_install signal re-fires enumeration.
    control.pushMessage(pluginInstallCompleted());
    await flush();
    expect(control.supportedCalls.length).toBe(2);
    control.supportedCalls[1]!.resolve([
      { name: "weave", description: "", argumentHint: "" } as SlashCommand,
      { name: "newskill", description: "", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    const allUpdates = framesCaptured.frames.filter(
      (f) => f.kind === "slash-commands-update",
    );
    expect(allUpdates.length).toBe(2);
    expect(allUpdates[1].body.commands.map((c: any) => c.name)).toEqual([
      "weave",
      "newskill",
    ]);

    await store.close();
  });

  test("step 5 (US-005 AC1+AC2): attach + idle ⇒ getContextUsage invoked and context-usage-update broadcast", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-5", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    const framesCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(framesCaptured));

    await flush();
    expect(control.usageCalls.length).toBe(1);
    control.usageCalls[0]!.resolve(
      usageResponse({ percentage: 42.3, totalTokens: 84_000, model: "claude-opus-4-7" }),
    );
    await flush();

    const updates = framesCaptured.frames.filter(
      (f) => f.kind === "context-usage-update",
    );
    expect(updates.length).toBe(1);
    expect(updates[0].body.percentage).toBe(42);

    // Idle transition re-polls.
    control.pushMessage(attachConfirmMessage());
    await flush();
    bridge.submitUserTurn(chat.id, "hi");
    await flush();
    control.pushMessage(idleResultMessage());
    await flush();
    expect(control.usageCalls.length).toBe(2);
    control.usageCalls[1]!.resolve(usageResponse({ percentage: 91, model: "claude-opus-4-7" }));
    await flush();

    const usageUpdates = framesCaptured.frames.filter(
      (f) => f.kind === "context-usage-update",
    );
    expect(usageUpdates.length).toBe(2);
    expect(usageUpdates[1].body.percentage).toBe(91);

    await store.close();
  });
});

describe("T-015 server smoke — classification + Ultrathink mapping cross-checks", () => {
  test("US-002 AC2: SKILL_NAMES includes weave / idea / forge / tune", () => {
    expect(SKILL_NAMES.has("weave")).toBe(true);
    expect(SKILL_NAMES.has("idea")).toBe(true);
    expect(SKILL_NAMES.has("forge")).toBe(true);
    expect(SKILL_NAMES.has("tune")).toBe(true);
  });

  test("classifySlashCommand returns 'skill' for SKILL_NAMES, 'command' otherwise (US-002 AC1)", () => {
    expect(
      classifySlashCommand({ name: "weave", description: "", argumentHint: "" } as SlashCommand),
    ).toBe("skill");
    expect(
      classifySlashCommand({ name: "model", description: "", argumentHint: "" } as SlashCommand),
    ).toBe("command");
  });

  test("US-008 AC3: Ultrathink tuple {effort:'max', thinking:{type:'enabled', budgetTokens:32000}} lands on Options", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "smoke-ultra", cwd: "/tmp/repo" });
    store.chats.update(chat.id, {
      model_settings: {
        model: null,
        effort: "max",
        thinking: { type: "enabled", budgetTokens: 32000 },
        contextWindow: null,
      },
    });
    const control = makeFakeQuery();
    const optsCaptured: CapturedOptions = { options: [] };
    const bridge = makeBridge(store, control, optsCaptured);
    await bridge.attach(chat.id, captureClient({ frames: [] }));

    const opts = optsCaptured.options[0];
    expect(opts.effort).toBe("max");
    expect(opts.thinking).toEqual({ type: "enabled", budgetTokens: 32000 });

    await store.close();
  });
});

describe("T-015 server smoke — FS-scanner guard", () => {
  test("bridge module does not reference the deleted FS scanner symbols", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const bridgePath = fileURLToPath(
      new URL("../src/process-manager/claude-session-bridge.ts", import.meta.url),
    );
    const src = readFileSync(bridgePath, "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*slash-commands\/scan["']/);
    expect(src).not.toMatch(/\bscanSlashCommands\b/);
  });
});
