/**
 * Bridge behaviour when the claude pane is dead / a send fails.
 *
 * The client seeds `turn-state running` optimistically on send and leaves
 * that state only on claude's `Stop` hook. So every input-path failure has
 * to end the turn explicitly, or the WorkingChip counts forever and the
 * stop button can't clear it (the pane is gone, so no hook will ever
 * arrive). These tests pin that contract:
 *
 *   - a failed live send, a failed queued flush, and a failed interrupt all
 *     broadcast `turn-state error` carrying the message
 *   - the snapshot a later client receives reports `idle`, so a reload
 *     doesn't re-arm the stuck chip
 *   - a confirmed-dead pane escalates to `session-state failed`, which is
 *     what makes the recovery banner's Retry reachable
 *   - `retrySession` actually respawns the pane and re-seats its clients
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
import { makeEnvelope } from "../src/chat-protocol/envelope.ts";

interface TmuxRec {
  api: TmuxSessionApi;
  calls: { ensure: string[]; kill: string[]; sendInput: string[]; interrupt: string[] };
}

/**
 * Tmux double whose pane is dead: `sendInput` / `interrupt` reject the way
 * `send-keys` does against a missing session, and `exists` reports false.
 * `paneAlive` flips the liveness answer for the escalation tests.
 */
function mkDeadTmux(opts: { paneAlive?: boolean } = {}): TmuxRec {
  const calls = { ensure: [] as string[], kill: [] as string[], sendInput: [] as string[], interrupt: [] as string[] };
  const api: TmuxSessionApi = {
    async ensure(chatId) {
      calls.ensure.push(chatId);
    },
    async kill(chatId) {
      calls.kill.push(chatId);
    },
    async sendInput(chatId) {
      calls.sendInput.push(chatId);
      throw new Error(`tmux: send-keys (literal) failed (code 1) for chat ${chatId}.`);
    },
    async sendKey() {},
    async interrupt(chatId) {
      calls.interrupt.push(chatId);
      throw new Error(`tmux: send-keys (key) failed (code 1) for chat ${chatId}.`);
    },
    async exists() {
      return opts.paneAlive ?? false;
    },
  };
  return { api, calls };
}

/** Tmux double that works, for the retry-respawn test. */
function mkLiveTmux(): TmuxRec {
  const calls = { ensure: [] as string[], kill: [] as string[], sendInput: [] as string[], interrupt: [] as string[] };
  const api: TmuxSessionApi = {
    async ensure(chatId) {
      calls.ensure.push(chatId);
    },
    async kill(chatId) {
      calls.kill.push(chatId);
    },
    async sendInput(chatId) {
      calls.sendInput.push(chatId);
    },
    async sendKey() {},
    async interrupt(chatId) {
      calls.interrupt.push(chatId);
    },
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function mkOpts(tmux: TmuxSessionApi): {
  opts: JsonlTailBridgeOptions;
  deleted: string[];
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-dead-pane-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const deleted: string[] = [];
  let seq = 0;
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
    // A fresh id per call so a retry-respawn is distinguishable from a resume.
    async getOrCreate(chatId, cwd): Promise<SessionEntry> {
      return { sessionId: `sess-${chatId}-${seq++}`, cwd, createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async delete(chatId) {
      deleted.push(chatId);
    },
    async upsert(_chatId, sessionId, cwd): Promise<SessionEntry> {
      return { sessionId, cwd: cwd ?? "", createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async findByClaudeSessionId() {
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
    },
    deleted,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeWs(): WsClient & { frames: () => any[]; reset: () => void } {
  const sent: string[] = [];
  return {
    send(text: string) {
      sent.push(text);
    },
    frames: () => sent.map((s) => JSON.parse(s)),
    reset: () => {
      sent.length = 0;
    },
  };
}

/** Flip a fresh chat to ready so submits take the warm send-now path. */
function markReady(bridge: ReturnType<typeof createJsonlTailBridge>, chatId: string): void {
  bridge.routeHookEnvelope(makeEnvelope("session-start", chatId, { sessionId: "s" }));
}

function turnStates(ws: { frames: () => any[] }): any[] {
  return ws.frames().filter((f) => f.kind === "turn-state");
}

describe("JsonlTailBridge — a failed send ends the turn", () => {
  it("broadcasts turn-state error when a warm send fails", async () => {
    // Pane alive, `send-keys` still failing: the failure is the send itself,
    // so there is nothing to respawn and the turn has to end in error.
    const { api } = mkDeadTmux({ paneAlive: true });
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      markReady(bridge, "c-1");
      ws.reset();
      // The rejection still reaches the caller (the ws layer turns it into
      // an error frame) — the turn-state broadcast is additive.
      await expect(bridge.submitUserTurn("c-1", "hello")).rejects.toThrow();
      const failed = turnStates(ws).find((f) => f.body.state === "error");
      expect(failed).toBeDefined();
      expect(failed.body.lastError).toContain("send-keys");
      // No lingering running as the LAST turn-state — the chip must clear.
      expect(turnStates(ws).at(-1).body.state).toBe("error");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("broadcasts turn-state error when a QUEUED turn fails to flush", async () => {
    // The cold-start path: the turn is queued and announced as running, then
    // the readiness fallback flushes it into a dead pane. Nobody awaits that
    // send, so without an explicit failure frame the client learns nothing
    // and the announced turn never ends.
    const { api } = mkDeadTmux();
    const { opts, cleanup } = mkOpts(api);
    opts.readyFallbackMs = 20;
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.reset();
      await bridge.submitUserTurn("c-1", "first message");
      expect(turnStates(ws).at(-1).body.state).toBe("running");
      // Past the fallback window: the flush runs and fails.
      await new Promise((r) => setTimeout(r, 80));
      const failed = turnStates(ws).find((f) => f.body.state === "error");
      expect(failed).toBeDefined();
      expect(failed.body.lastError).toContain("Failed to send message");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("broadcasts turn-state error when interrupt fails, so stop is escapable", async () => {
    const { api } = mkDeadTmux();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      markReady(bridge, "c-1");
      ws.reset();
      await expect(bridge.interrupt("c-1")).rejects.toThrow();
      const failed = turnStates(ws).find((f) => f.body.state === "error");
      expect(failed).toBeDefined();
      expect(failed.body.lastError).toContain("Failed to interrupt");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("reports idle in the snapshot after a failure, so a reload doesn't re-arm the chip", async () => {
    const { api } = mkDeadTmux({ paneAlive: true });
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const first = makeWs();
      await bridge.attach("c-1", first);
      markReady(bridge, "c-1");
      await expect(bridge.submitUserTurn("c-1", "hello")).rejects.toThrow();
      // A reload = a fresh client attaching to the same chat.
      const reloaded = makeWs();
      await bridge.attach("c-1", reloaded);
      const snapshot = reloaded.frames().find((f) => f.kind === "snapshot");
      expect(snapshot.body.turnState).toBe("idle");
      expect(snapshot.body.turnStartedAt).toBeNull();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});

describe("JsonlTailBridge — dead-pane escalation", () => {
  it("escalates to session-state failed when the pane is gone", async () => {
    // Driven through `interrupt`, which talks to the pane directly instead of
    // going through the respawn path a submit would take.
    const { api } = mkDeadTmux({ paneAlive: false });
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.reset();
      await expect(bridge.interrupt("c-1")).rejects.toThrow();
      // The liveness probe is fire-and-forget; let it settle.
      await new Promise((r) => setTimeout(r, 10));
      const failed = ws
        .frames()
        .find((f) => f.kind === "session-state" && f.body.lifecycle === "failed");
      expect(failed).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("does NOT escalate when the pane is still alive", async () => {
    // A transient send failure against a live pane is not a dead session —
    // ending the turn is enough, and a recovery banner would be noise.
    const { api } = mkDeadTmux({ paneAlive: true });
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      markReady(bridge, "c-1");
      ws.reset();
      await expect(bridge.submitUserTurn("c-1", "hello")).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 10));
      expect(turnStates(ws).find((f) => f.body.state === "error")).toBeDefined();
      expect(
        ws.frames().find((f) => f.kind === "session-state" && f.body.lifecycle === "failed"),
      ).toBeUndefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});

describe("JsonlTailBridge — a lost pane is respawned", () => {
  /** Tmux whose pane is always reported gone, but which spawns and sends fine. */
  function mkVanishingTmux(): TmuxRec {
    const rec = mkLiveTmux();
    return { calls: rec.calls, api: { ...rec.api, async exists() { return false; } } };
  }

  it("re-attaching to a chat whose pane died spawns a new one", async () => {
    // The registry hit used to be returned unconditionally, pinning the chat
    // to the dead session for the life of the server — no reload could fix it.
    const { api, calls } = mkVanishingTmux();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      expect(calls.ensure).toEqual(["c-1"]);
      await bridge.attach("c-1", makeWs());
      expect(calls.ensure).toEqual(["c-1", "c-1"]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("a send into a dead pane respawns and delivers instead of failing", async () => {
    const { api, calls } = mkVanishingTmux();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      markReady(bridge, "c-1");
      // The respawned session starts cold, so the turn queues rather than
      // erroring; the readiness edge then flushes it to the live pane.
      await bridge.submitUserTurn("c-1", "hello");
      expect(calls.ensure).toEqual(["c-1", "c-1"]);
      markReady(bridge, "c-1");
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.sendInput).toEqual(["c-1"]);
      expect(turnStates(ws).find((f) => f.body.state === "error")).toBeUndefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("carries attached clients onto the respawned state", async () => {
    // A second tab that didn't trigger the respawn must keep receiving frames.
    const { api } = mkVanishingTmux();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const observer = makeWs();
      await bridge.attach("c-1", observer);
      observer.reset();
      // A different client re-attaches, which triggers the respawn.
      await bridge.attach("c-1", makeWs());
      // The observer is re-seated and told the timeline reset.
      const snapshot = observer.frames().find((f) => f.kind === "snapshot");
      expect(snapshot).toBeDefined();
      expect(snapshot.body.turnState).toBe("idle");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});

describe("JsonlTailBridge — retrySession respawns", () => {
  it("kills, drops the stored id, and spawns a NEW pane for the same chat", async () => {
    // The old implementation left the chat in the registry, so
    // `ensureChatState` short-circuited onto the state bound to the pane it
    // had just killed and every later send failed against a dead session.
    const { api, calls } = mkLiveTmux();
    const { opts, deleted, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      expect(calls.ensure).toEqual(["c-1"]);
      ws.reset();
      await bridge.retrySession("c-1");
      expect(calls.kill).toContain("c-1");
      expect(deleted).toContain("c-1");
      // The decisive assertion: a second spawn happened.
      expect(calls.ensure).toEqual(["c-1", "c-1"]);
      // And the still-attached client is re-seated with a fresh idle snapshot.
      const snapshot = ws.frames().find((f) => f.kind === "snapshot");
      expect(snapshot).toBeDefined();
      expect(snapshot.body.turnState).toBe("idle");
      // The respawned chat is usable — no send against a dead pane.
      markReady(bridge, "c-1");
      await bridge.submitUserTurn("c-1", "after retry");
      expect(calls.sendInput).toEqual(["c-1"]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
