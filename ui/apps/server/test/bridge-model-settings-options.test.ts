/**
 * T-003 — Bridge plumbs SDK `Options` from chat-row at spawn.
 *
 * Asserts that `startQuery()` reads the chat-row's `model_settings`
 * JSON on every invocation and injects `model` / `effort` / `thinking` /
 * `betas` into the SDK `Options` block per the ADR-D04 mapping.
 *
 * Test seam: a `sdkQueryFactory` injection on the bridge constructor
 * captures the `Options` argument passed to the SDK `query()` factory
 * without spinning up a real SDK transport. The bridge is otherwise
 * driven through its real `attach()` → `spawn()` → `startQuery()` path
 * so the chat-row read happens at the production call site.
 */
import { describe, expect, test, vi } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";

/**
 * Ultrathink budget literal. The pill ({@link
 * ui/apps/web/src/components/chat/ModelSettingsPill.tsx}) is the source
 * of truth — the bridge receives this value via the wire
 * `thinking.budgetTokens` field and never references its own constant.
 */
const ULTRATHINK_BUDGET_TOKENS = 32000;
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { WireModelSettings } from "../src/chat-protocol/messages.ts";

function fakeClient() {
  return {
    send(_frame: unknown) {},
  } as any;
}

function fakeQueryHandle(): Query {
  return {
    setPermissionMode: async () => undefined,
    interrupt: async () => undefined,
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
      } as AsyncIterator<unknown>;
    },
  } as unknown as Query;
}

interface Captured {
  options: any[];
}

function makeBridge(store: any, captured: Captured) {
  return new ClaudeSessionBridge(store, {
    config: { worktreesRoot: null } as any,
    resolveSpawnCwd: async () => ({
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: null,
    }),
    sdkQueryFactory: ({ options }: { prompt: any; options: any }) => {
      captured.options.push(options);
      return fakeQueryHandle();
    },
  } as any);
}

describe("T-003 bridge plumbs SDK Options from chat-row", () => {
  test("model_settings === null: none of model/effort/thinking/betas land in Options", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-null", cwd: "/tmp/repo" });
    expect(store.chats.get(chat.id)?.model_settings).toBeNull();
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    expect(captured.options.length).toBe(1);
    const opts = captured.options[0];
    expect(opts.model).toBeUndefined();
    expect(opts.effort).toBeUndefined();
    expect(opts.thinking).toBeUndefined();
    expect(opts.betas).toBeUndefined();
    await store.close();
  });

  test("model + effort set, thinking/contextWindow null: only model + effort land", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-me", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: "xhigh",
      thinking: null,
      contextWindow: null,
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    const opts = captured.options[0];
    expect(opts.model).toBe("claude-opus-4-7");
    expect(opts.effort).toBe("xhigh");
    expect(opts.thinking).toBeUndefined();
    expect(opts.betas).toBeUndefined();
    await store.close();
  });

  test("thinking set: thinking lands; contextWindow not written to Options", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-th", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: null,
      effort: "max",
      thinking: { type: "enabled", budgetTokens: ULTRATHINK_BUDGET_TOKENS },
      contextWindow: null,
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    const opts = captured.options[0];
    expect(opts.effort).toBe("max");
    expect(opts.thinking).toEqual({ type: "enabled", budgetTokens: 32000 });
    expect(opts.contextWindow).toBeUndefined();
    expect(opts.betas).toBeUndefined();
    await store.close();
  });

  test("contextWindow === '1m': betas = ['context-1m-2025-08-07'] (ADR-D04)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-1m", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: null,
      effort: null,
      thinking: null,
      contextWindow: "1m",
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    const opts = captured.options[0];
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
    expect(opts.contextWindow).toBeUndefined();
    await store.close();
  });

  test("contextWindow === '200k': betas omitted", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-200", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: null,
      effort: null,
      thinking: null,
      contextWindow: "200k",
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    const opts = captured.options[0];
    expect(opts.betas).toBeUndefined();
    await store.close();
  });

  test("chatRepo.get is invoked on every startQuery call (re-read per spawn)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-spy", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: null,
      thinking: null,
      contextWindow: null,
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const getSpy = vi.spyOn(store.chats, "get");
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    // Drop the spawn-time `chats.get` (attach() calls it once before
    // spawn). What we care about is that startQuery() re-reads the row
    // via chats.get for the model-settings tuple — assert by counting
    // calls keyed to the chat id.
    const callsForChat = getSpy.mock.calls.filter((args) => args[0] === chat.id);
    expect(callsForChat.length).toBeGreaterThanOrEqual(2);
    const opts = captured.options[0];
    expect(opts.model).toBe("claude-opus-4-7");
    await store.close();
  });

  test("full tuple: model + effort='max' + thinking + contextWindow='1m' all land", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c-full", cwd: "/tmp/repo" });
    const tuple: WireModelSettings = {
      model: "claude-sonnet-4-6",
      effort: "max",
      thinking: { type: "enabled", budgetTokens: 32000 },
      contextWindow: "1m",
    };
    store.chats.update(chat.id, { model_settings: tuple });
    const captured: Captured = { options: [] };
    const bridge = makeBridge(store, captured);
    await bridge.attach(chat.id, fakeClient());
    const opts = captured.options[0];
    expect(opts.model).toBe("claude-sonnet-4-6");
    expect(opts.effort).toBe("max");
    expect(opts.thinking).toEqual({ type: "enabled", budgetTokens: 32000 });
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
    await store.close();
  });
});
