/**
 * T-010 — Bridge user-input methods.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonlTailBridge,
  type JsonlTailBridgeOptions,
  type WsClient,
} from "../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore, SessionEntry } from "../src/process-manager/session-store.ts";
import type {
  GateResolution,
  PermissionGate,
} from "../src/hook-receiver/permission-gate.ts";
import { makeEnvelope } from "../src/chat-protocol/envelope.ts";

/**
 * Flip a freshly-attached chat to ready by routing the `SessionStart`
 * hook envelope — the production cold-start readiness edge (F1). After
 * attach a chat starts NOT ready (turns enqueue, not send), so input
 * tests that assert an immediate send must signal readiness first.
 */
function markReady(bridge: ReturnType<typeof createJsonlTailBridge>, chatId: string): void {
  bridge.routeHookEnvelope(makeEnvelope("session-start", chatId, { sessionId: "s" }));
}

/**
 * Recording permission gate. respondToPermission resolves the gate instead of
 * injecting tmux keystrokes, so the tests assert against `resolved` here.
 */
function mkGateRec(): {
  gate: PermissionGate;
  resolved: { chatId: string; id: string; resolution: GateResolution }[];
} {
  const resolved: { chatId: string; id: string; resolution: GateResolution }[] = [];
  const gate: PermissionGate = {
    register() {
      // Unit tests drive respondToPermission directly; no real curl is held.
      return new Promise<GateResolution>(() => {});
    },
    resolve(chatId, id, resolution) {
      resolved.push({ chatId, id, resolution });
      return true;
    },
    rejectAll() {},
    pendingCount() {
      return 0;
    },
  };
  return { gate, resolved };
}

function mkTmuxRec(): { api: TmuxSessionApi; calls: { sendInput: { chatId: string; text: string }[]; sendKey: { chatId: string; key: string }[]; interrupt: string[]; kill: string[]; ensure: { chatId: string; cwd: string; sessionId: string }[] } } {
  const calls = {
    sendInput: [] as { chatId: string; text: string }[],
    sendKey: [] as { chatId: string; key: string }[],
    interrupt: [] as string[],
    kill: [] as string[],
    ensure: [] as { chatId: string; cwd: string; sessionId: string }[],
  };
  const api: TmuxSessionApi = {
    async ensure(chatId, cwd, sessionId) {
      calls.ensure.push({ chatId, cwd, sessionId });
    },
    async kill(chatId) {
      calls.kill.push(chatId);
    },
    async sendInput(chatId, text) {
      calls.sendInput.push({ chatId, text });
    },
    async sendKey(chatId, key) {
      calls.sendKey.push({ chatId, key });
    },
    async interrupt(chatId) {
      calls.interrupt.push(chatId);
    },
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function mkOpts(
  tmux: TmuxSessionApi,
  permissionGate?: PermissionGate,
): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-input-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const store: SessionIdStore = {
    async getOrCreate(chatId, cwd): Promise<SessionEntry> {
      return { sessionId: `sess-${chatId}`, cwd, createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async delete() {},
    async upsert(_chatId, sessionId, cwd): Promise<SessionEntry> {
      return { sessionId, cwd: cwd ?? "", createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async findByClaudeSessionId(): Promise<string | undefined> {
      return undefined;
    },
  };
  return {
    opts: {
      tmux,
      sessionStore: store,
      tailRoot,
      paneProcess: {
        async paneRootPid() {
          return 12345;
        },
        async paneOwnsFile() {
          return true;
        },
        gateDegraded() {
          return false;
        },
      },
      cwdResolver: async (chatId) => `/tmp/${chatId}`,
      tailPollingMs: 25,
      permissionGate,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeWs(): WsClient & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    send(text: string) {
      sent.push(text);
    },
  };
}

describe("JsonlTailBridge — user-input surface (T-010)", () => {
  it("submitUserTurn calls tmux.sendInput exactly once with the text", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      markReady(bridge, "c-1");
      await bridge.submitUserTurn("c-1", "hello");
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "hello" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("F3 — a WARM submitUserTurn broadcasts turn-state running (in addition to sending)", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      // Warm path: mark ready so the send goes out immediately rather
      // than enqueuing (the cold-start branch already emits running).
      markReady(bridge, "c-1");
      ws.sent.length = 0;
      await bridge.submitUserTurn("c-1", "hello");
      // The text still reaches tmux exactly once.
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "hello" }]);
      // AND a running turn-state is broadcast so passive observers (a
      // second tab) get an authoritative "Claude is thinking" signal.
      const frames = ws.sent.map((s) => JSON.parse(s));
      const running = frames.find(
        (f) => f.kind === "turn-state" && f.body.state === "running",
      );
      expect(running).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("interrupt calls tmux.interrupt exactly once", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.interrupt("c-1");
      expect(calls.interrupt).toEqual(["c-1"]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission(allow) resolves the gate with allow + clears pending-permission (no keystrokes)", async () => {
    const { api, calls } = mkTmuxRec();
    const { gate, resolved } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.respondToPermission("c-1", "perm-1", "allow", {});
      // The held PreToolUse hook is resolved with `allow` — that unblocks the
      // agent. Crucially NO tmux keystroke is sent (the old path injected "1",
      // which landed on the composer and corrupted the turn).
      expect(resolved).toEqual([
        { chatId: "c-1", id: "perm-1", resolution: { decision: "allow", reason: undefined } },
      ]);
      expect(calls.sendInput).toEqual([]);
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "pending-permission" && f.body === null)).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission(deny) resolves the gate with deny (no keystrokes)", async () => {
    const { api, calls } = mkTmuxRec();
    const { gate, resolved } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.respondToPermission("c-1", "perm-1", "deny", {});
      expect(resolved).toEqual([
        { chatId: "c-1", id: "perm-1", resolution: { decision: "deny", reason: undefined } },
      ]);
      expect(calls.sendInput).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission forwards a deny message as the gate's permissionDecisionReason", async () => {
    const { api } = mkTmuxRec();
    const { gate, resolved } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.respondToPermission("c-1", "perm-9", "deny", {
        message: "not allowed here",
      });
      expect(resolved).toEqual([
        { chatId: "c-1", id: "perm-9", resolution: { decision: "deny", reason: "not allowed here" } },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission emits a permission-resolved frame carrying the original id + the user's behavior verb (N1)", async () => {
    // Spec §US-003 AC5 / §US-009 AC3 mandate a `permission-resolved`
    // acknowledgement frame after the decision is resolved. The body must
    // carry the original prompt-id plus the user's choice (`"allow"` /
    // `"deny"`) so clients can audit which prompt was resolved and how.
    const { api, calls } = mkTmuxRec();
    const { gate } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.respondToPermission("c-1", "perm-42", "allow", {});
      const frames = ws.sent.map((s) => JSON.parse(s));
      const resolved = frames.find((f) => f.kind === "permission-resolved");
      expect(resolved).toBeDefined();
      expect(resolved["chat-id"]).toBe("c-1");
      expect(resolved.body).toEqual({ id: "perm-42", behavior: "allow" });
      // The pending-permission clear (body:null) is complementary, not
      // replaced — both signals reach attached clients.
      const cleared = frames.find(
        (f) => f.kind === "pending-permission" && f.body === null,
      );
      expect(cleared).toBeDefined();
      // No keystroke injection — the gate resolution is the sole mechanism.
      expect(calls.sendInput).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission(deny) emits permission-resolved with behavior:\"deny\"", async () => {
    const { api } = mkTmuxRec();
    const { gate } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.respondToPermission("c-1", "perm-7", "deny", {});
      const frames = ws.sent.map((s) => JSON.parse(s));
      const resolved = frames.find((f) => f.kind === "permission-resolved");
      expect(resolved?.body).toEqual({ id: "perm-7", behavior: "deny" });
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion: with no pending state, falls back to the first answer id", async () => {
    // No PendingQuestion registered → bridge can't map id → index, so it
    // sends the first answer string raw. (Real flow: the hook receiver
    // installs a PendingQuestion before the user can answer.)
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.respondToQuestion("c-1", "q-1", { answers: ["a", "b"] });
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "a" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion: single-select sends the bare option-number key (no Enter)", async () => {
    // claude's AskUserQuestion TUI is a navigable numbered list where the
    // option's number key is a quick-select that confirms in one stroke. The
    // bridge looks up the answer-id, then drives the widget with a bare
    // keystroke via sendKey — NOT sendInput, which would append a stray Enter.
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      // Install a pending question via the hook-envelope path.
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "askuserquestion",
          data: {
            id: "q-1",
            question: "Pick?",
            options: [
              { id: "opt-1", label: "A" },
              { id: "opt-2", label: "B" },
              { id: "opt-3", label: "C" },
            ],
          },
        }),
      );
      await bridge.respondToQuestion("c-1", "q-1", { answers: ["opt-2"] });
      expect(calls.sendKey).toEqual([{ chatId: "c-1", key: "2" }]);
      expect(calls.sendInput).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion releases the held AskUserQuestion gate with `defer` and still drives the widget", async () => {
    // The gate is a HOLD only: resolving it with `defer` lets claude render
    // its question widget; the chosen option still travels via the keystroke
    // (here the bare option-number key), NOT via the gate decision.
    const { api, calls } = mkTmuxRec();
    const { gate, resolved } = mkGateRec();
    const { opts, cleanup } = mkOpts(api, gate);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "askuserquestion",
          data: {
            id: "q-1",
            question: "Pick?",
            options: [
              { id: "opt-1", label: "A" },
              { id: "opt-2", label: "B" },
            ],
          },
        }),
      );
      await bridge.respondToQuestion("c-1", "q-1", { answers: ["opt-2"] });
      expect(resolved).toEqual([
        { chatId: "c-1", id: "q-1", resolution: { decision: "defer" } },
      ]);
      // The widget is still driven by the bare option-number keystroke.
      expect(calls.sendKey).toEqual([{ chatId: "c-1", key: "2" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion: multi-select toggles each option then navigates Right + Submit", async () => {
    // claude's multi-select widget: number keys TOGGLE checkboxes, then
    // "Right" opens the Submit review tab where "1" confirms. The bridge
    // drives all of this via bare keystrokes (sendKey), never sendInput.
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "askuserquestion",
          data: {
            id: "q-1",
            question: "Pick many?",
            multiSelect: true,
            options: [
              { id: "opt-1", label: "A" },
              { id: "opt-2", label: "B" },
              { id: "opt-3", label: "C" },
            ],
          },
        }),
      );
      await bridge.respondToQuestion("c-1", "q-1", { answers: ["opt-1", "opt-3"] });
      expect(calls.sendKey).toEqual([
        { chatId: "c-1", key: "1" },
        { chatId: "c-1", key: "3" },
        { chatId: "c-1", key: "Right" },
        { chatId: "c-1", key: "1" },
      ]);
      expect(calls.sendInput).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion: __freeform__ with no pending state types the text directly", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.respondToQuestion("c-1", "q-1", {
        answers: ["__freeform__"],
        otherText: "custom answer",
      });
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "custom answer" },
      ]);
      expect(calls.sendKey).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToQuestion: __freeform__ with pending single-select navigates to the 'Type something' row then types", async () => {
    // claude appends a "Type something" row after the parsed options; its
    // number key (options.length + 1) only moves the cursor there, then the
    // typed text fills it inline and Enter (from sendInput) submits.
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "askuserquestion",
          data: {
            id: "q-1",
            question: "Pick?",
            options: [
              { id: "opt-1", label: "A" },
              { id: "opt-2", label: "B" },
              { id: "opt-3", label: "C" },
            ],
          },
        }),
      );
      await bridge.respondToQuestion("c-1", "q-1", {
        answers: ["__freeform__"],
        otherText: "custom answer",
      });
      // 3 options → "Type something" is row 4.
      expect(calls.sendKey).toEqual([{ chatId: "c-1", key: "4" }]);
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "custom answer" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("submitUserTurn(images): stages via the image store and appends @<path> to the text", async () => {
    // Replaces the prior "not supported by the JSONL bridge" contract — image
    // turns are now wired through (T-003). With an injected image store the
    // bridge stages each image and appends an @<absPath> token to the send.
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    opts.imageStore = {
      async stageTurnImages() {
        return [{ absPath: "/abs/img.png", mediaType: "image/png" }];
      },
      lookupByPath() {
        return undefined;
      },
    };
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      markReady(bridge, "c-1");
      ws.sent.length = 0;
      await bridge.submitUserTurn("c-1", "with image", [
        { mediaType: "image/png", dataB64: "abcd" },
      ]);
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "with image @/abs/img.png" },
      ]);
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "error")).toBeUndefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});

describe("JsonlTailBridge — cold-start readiness gate (F1)", () => {
  it("a turn submitted before session-start is QUEUED (not sent) and emits turn-state running", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      // Fresh spawn ⇒ not ready ⇒ enqueue, do not send.
      await bridge.submitUserTurn("c-1", "first message");
      expect(calls.sendInput).toEqual([]);
      // The send is not silent — a running turn-state goes out so the
      // WorkingChip shows progress while claude boots.
      const frames = ws.sent.map((s) => JSON.parse(s));
      const running = frames.find(
        (f) => f.kind === "turn-state" && f.body.state === "running",
      );
      expect(running).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("the queued turn is sent only AFTER session-start arrives", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.submitUserTurn("c-1", "deferred message");
      expect(calls.sendInput).toEqual([]);
      // Readiness edge: flush.
      markReady(bridge, "c-1");
      // Flush is async (runs through the send chain); let microtasks drain.
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "deferred message" },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("two rapid pre-ready turns flush as TWO separate sendInput calls, in order, never merged", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      // Submit two turns back-to-back before claude is ready.
      await bridge.submitUserTurn("c-1", "what is this repo about?");
      await bridge.submitUserTurn("c-1", "Run the bash command: ls");
      expect(calls.sendInput).toEqual([]);
      markReady(bridge, "c-1");
      await new Promise((r) => setTimeout(r, 0));
      // The invariant: TWO distinct sends in submission order — never the
      // merged single bubble the live race produced.
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "what is this repo about?" },
        { chatId: "c-1", text: "Run the bash command: ls" },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("fallback timeout flushes the queue if session-start never arrives", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    // Tiny fallback so the no-hang path is exercised deterministically.
    opts.readyFallbackMs = 20;
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.submitUserTurn("c-1", "no hooks here");
      expect(calls.sendInput).toEqual([]);
      // Wait past the fallback window — no session-start is ever routed.
      await new Promise((r) => setTimeout(r, 60));
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "no hooks here" },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("once ready, a subsequent turn sends immediately (warm path)", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      markReady(bridge, "c-1");
      await bridge.submitUserTurn("c-1", "warm one");
      await bridge.submitUserTurn("c-1", "warm two");
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "warm one" },
        { chatId: "c-1", text: "warm two" },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
