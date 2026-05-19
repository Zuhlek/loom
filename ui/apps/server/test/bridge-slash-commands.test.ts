/**
 * T-004 — Bridge enumerates SDK commands + classifies + broadcasts.
 *
 * Asserts that the bridge:
 *   - calls `query.supportedCommands()` after the first non-error SDK
 *     message confirms attach,
 *   - classifies each row via `classifySlashCommand`,
 *   - stores the catalog on the session,
 *   - broadcasts a `slash-commands-update` frame to attached clients,
 *   - re-fires enumeration when an SDK plugin-install signal lands,
 *   - backfills late-joining clients on re-attach,
 *   - leaves the catalog untouched and emits no frame when
 *     `supportedCommands()` throws.
 *
 * Driven through the real `attach()` + SDK message loop via the
 * `sdkQueryFactory` test seam so the production call sites are exercised.
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import {
  ClaudeSessionBridge,
  classifySlashCommand,
  SKILL_NAMES,
} from "../src/process-manager/claude-session-bridge.ts";
import type { Query, SDKMessage, SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { WireSlashCommand } from "../src/chat-protocol/messages.ts";

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
  /** Push an SDK message into the running for-await loop. */
  pushMessage(msg: SDKMessage): void;
  /** Resolve the next SDK iterator step with `done: true`. */
  end(): void;
  /** Track calls to `supportedCommands()` (FIFO). */
  supportedCalls: Array<{ resolve: (rows: SlashCommand[]) => void; reject: (err: unknown) => void }>;
}

function makeFakeQuery(): FakeQueryControl {
  const buffered: SDKMessage[] = [];
  const waiters: Array<(r: IteratorResult<SDKMessage>) => void> = [];
  let ended = false;
  const supportedCalls: FakeQueryControl["supportedCalls"] = [];

  const query = {
    setPermissionMode: async () => undefined,
    interrupt: async () => undefined,
    supportedCommands: () =>
      new Promise<SlashCommand[]>((resolve, reject) => {
        supportedCalls.push({ resolve, reject });
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
    pushMessage(msg) {
      const w = waiters.shift();
      if (w) w({ value: msg, done: false });
      else buffered.push(msg);
    },
    end() {
      ended = true;
      while (waiters.length > 0) waiters.shift()!({ value: undefined as unknown as SDKMessage, done: true });
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

/** A synthetic non-error SDK message that confirms attach. */
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
    name: "some-skill",
    uuid: "u-plug",
    session_id: "s",
  } as unknown as SDKMessage;
}

/** Wait microtasks/macrotasks. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("T-004 bridge slash-command enumeration", () => {
  test("SKILL_NAMES exports the curated set (ADR-D05) — includes 'weave' and 'forge'", () => {
    expect(SKILL_NAMES.has("weave")).toBe(true);
    expect(SKILL_NAMES.has("forge")).toBe(true);
    expect(SKILL_NAMES.has("idea")).toBe(true);
    expect(SKILL_NAMES.has("tune")).toBe(true);
  });

  test("classifySlashCommand returns 'skill' for SKILL_NAMES, 'command' otherwise", () => {
    expect(classifySlashCommand({ name: "weave", description: "", argumentHint: "" } as SlashCommand))
      .toBe("skill");
    expect(classifySlashCommand({ name: "model", description: "", argumentHint: "" } as SlashCommand))
      .toBe("command");
  });

  test("first non-error SDK message triggers supportedCommands(), broadcast classified frame", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    // Confirm attach via a non-error system message.
    control.pushMessage(attachConfirmMessage());
    await flush();

    expect(control.supportedCalls.length).toBe(1);
    control.supportedCalls[0]!.resolve([
      { name: "weave", description: "weave d", argumentHint: "" } as SlashCommand,
      { name: "model", description: "model d", argumentHint: "" } as SlashCommand,
      { name: "forge", description: "forge d", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "slash-commands-update");
    expect(updates.length).toBe(1);
    const cmds: WireSlashCommand[] = updates[0].body.commands;
    expect(cmds).toEqual([
      { name: "weave", description: "weave d", argumentHint: "", kind: "skill" },
      { name: "model", description: "model d", argumentHint: "", kind: "command" },
      { name: "forge", description: "forge d", argumentHint: "", kind: "skill" },
    ]);

    // Subsequent non-error messages do NOT re-trigger enumeration.
    control.pushMessage(attachConfirmMessage());
    await flush();
    expect(control.supportedCalls.length).toBe(1);

    await store.close();
  });

  test("plugin_install SDK message re-fires supportedCommands() and re-broadcasts", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c2", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    control.pushMessage(attachConfirmMessage());
    await flush();
    control.supportedCalls[0]!.resolve([
      { name: "weave", description: "", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    control.pushMessage(pluginInstallCompleted());
    await flush();
    expect(control.supportedCalls.length).toBe(2);
    control.supportedCalls[1]!.resolve([
      { name: "weave", description: "", argumentHint: "" } as SlashCommand,
      { name: "newskill", description: "", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "slash-commands-update");
    expect(updates.length).toBe(2);
    expect(updates[1].body.commands.map((c: WireSlashCommand) => c.name)).toEqual(["weave", "newskill"]);

    await store.close();
  });

  test("supportedCommands() rejection leaves slashCommands at prior value, no frame emitted", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c3", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const captured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(captured));

    control.pushMessage(attachConfirmMessage());
    await flush();
    expect(control.supportedCalls.length).toBe(1);
    control.supportedCalls[0]!.reject(new Error("boom"));
    await flush();

    const updates = captured.frames.filter((f) => f.kind === "slash-commands-update");
    expect(updates.length).toBe(0);

    await store.close();
  });

  test("re-attach after catalog loaded emits backfill frame to the joining client only", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c4", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const firstCaptured: Captured = { frames: [] };
    const firstClient = captureClient(firstCaptured);
    await bridge.attach(chat.id, firstClient);

    control.pushMessage(attachConfirmMessage());
    await flush();
    control.supportedCalls[0]!.resolve([
      { name: "weave", description: "", argumentHint: "" } as SlashCommand,
    ]);
    await flush();

    expect(firstCaptured.frames.filter((f) => f.kind === "slash-commands-update").length).toBe(1);

    const secondCaptured: Captured = { frames: [] };
    const secondClient = captureClient(secondCaptured);
    await bridge.attach(chat.id, secondClient);

    // Second client receives an immediate backfill.
    const secondUpdates = secondCaptured.frames.filter((f) => f.kind === "slash-commands-update");
    expect(secondUpdates.length).toBe(1);
    expect(secondUpdates[0].body.commands).toEqual([
      { name: "weave", description: "", argumentHint: "", kind: "skill" },
    ]);

    // First client does NOT receive a duplicate broadcast on the
    // re-attach — backfill is targeted to the joining client only.
    expect(firstCaptured.frames.filter((f) => f.kind === "slash-commands-update").length).toBe(1);

    await store.close();
  });

  test("re-attach before any catalog has loaded does NOT emit a backfill frame", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c5", cwd: "/tmp/repo" });
    const control = makeFakeQuery();
    const bridge = makeBridge(store, control);
    const firstCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(firstCaptured));

    // No attachConfirmMessage yet — slashCommands stays null.
    const secondCaptured: Captured = { frames: [] };
    await bridge.attach(chat.id, captureClient(secondCaptured));

    expect(secondCaptured.frames.filter((f) => f.kind === "slash-commands-update").length).toBe(0);

    await store.close();
  });
});
