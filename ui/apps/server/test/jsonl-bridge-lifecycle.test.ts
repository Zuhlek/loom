/**
 * T-009 — JsonlTailBridge lifecycle (attach / detach / hasSession / dispose).
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonlTailBridge,
  type JsonlTailBridgeOptions,
} from "../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore, SessionEntry } from "../src/process-manager/session-store.ts";
import type { JsonlPathProbe, ResolvedTailRoot } from "../src/process-manager/jsonl-path-probe.ts";

function mkTmux(overrides: Partial<TmuxSessionApi> = {}): TmuxSessionApi {
  const calls: Record<string, unknown[]> = {
    ensure: [],
    kill: [],
    sendInput: [],
    interrupt: [],
    exists: [],
  };
  const api: TmuxSessionApi = {
    async ensure(chatId, cwd, sessionId) {
      calls.ensure!.push({ chatId, cwd, sessionId });
    },
    async kill(chatId) {
      calls.kill!.push(chatId);
    },
    async sendInput(chatId, text) {
      calls.sendInput!.push({ chatId, text });
    },
    async interrupt(chatId) {
      calls.interrupt!.push(chatId);
    },
    async exists(chatId) {
      calls.exists!.push(chatId);
      return true;
    },
    ...overrides,
  };
  (api as any).__calls = calls;
  return api;
}

function mkStore(map: Record<string, SessionEntry> = {}): SessionIdStore {
  const calls: Record<string, unknown[]> = { get: [], getOrCreate: [], delete: [], upsert: [] };
  const store: SessionIdStore = {
    async get(chatId) {
      calls.get!.push(chatId);
      return map[chatId];
    },
    async getOrCreate(chatId, cwd) {
      calls.getOrCreate!.push({ chatId, cwd });
      const existing = map[chatId];
      if (existing) return existing;
      const e: SessionEntry = {
        sessionId: `sess-${chatId}`,
        cwd,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      map[chatId] = e;
      return e;
    },
    async delete(chatId) {
      calls.delete!.push(chatId);
      delete map[chatId];
    },
    async upsert(chatId, sessionId, cwd) {
      calls.upsert!.push({ chatId, sessionId, cwd });
      const prior = map[chatId];
      const e: SessionEntry = {
        sessionId,
        cwd: cwd ?? prior?.cwd ?? "",
        createdAt: prior?.createdAt ?? "2026-01-01T00:00:00.000Z",
      };
      map[chatId] = e;
      return e;
    },
    async findByClaudeSessionId(sessionId) {
      for (const [chatId, entry] of Object.entries(map)) {
        if (entry.sessionId === sessionId) return chatId;
      }
      return undefined;
    },
  };
  (store as any).__calls = calls;
  return store;
}

function mkProbe(tailRoot: string): JsonlPathProbe {
  const resolved: ResolvedTailRoot = {
    tailRoot,
    encodingScheme: "cwd-slash-encoded",
    resolvedAt: "2026-01-01T00:00:00.000Z",
    claudeVersionAtProbe: "test",
  };
  return {
    async resolve() {
      return resolved;
    },
    async reprobe() {
      return resolved;
    },
    encodeCwd(cwd) {
      return cwd.replace(/\//g, "-");
    },
  };
}

function freshOpts(): { opts: JsonlTailBridgeOptions; cleanup: () => void; tailRoot: string; tmux: TmuxSessionApi; store: SessionIdStore } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-test-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const tmux = mkTmux();
  const store = mkStore();
  const opts: JsonlTailBridgeOptions = {
    tmux,
    sessionStore: store,
    pathProbe: mkProbe(tailRoot),
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
    cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
    // Faster polling for tests.
    tailPollingMs: 25,
  };
  return {
    opts,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    tailRoot,
    tmux,
    store,
  };
}

function makeWs() {
  return {
    sent: [] as string[],
    send(text: string) {
      this.sent.push(text);
    },
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

describe("JsonlTailBridge lifecycle", () => {
  it("first attach: triggers sessionStore.getOrCreate + tmux.ensure + opens tail", async () => {
    const { opts, cleanup, tmux, store } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      const ensures = (tmux as any).__calls.ensure as unknown[];
      const creates = (store as any).__calls.getOrCreate as unknown[];
      expect(ensures).toHaveLength(1);
      expect(creates).toHaveLength(1);
      await bridge.dispose("chat-1");
    } finally {
      cleanup();
    }
  });

  it("second attach for same chat: reuses ChatState and delivers a snapshot frame", async () => {
    const { opts, cleanup, tmux } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws1 = makeWs();
      const ws2 = makeWs();
      await bridge.attach("chat-1", ws1);
      ws1.sent.length = 0;
      ws2.sent.length = 0;
      await bridge.attach("chat-1", ws2);
      // ws2 receives a snapshot frame before any deltas.
      const firstFrames = ws2.sent.map((s) => JSON.parse(s));
      expect(firstFrames[0]?.kind).toBe("snapshot");
      // tmux.ensure was called only once across both attaches.
      const ensures = (tmux as any).__calls.ensure as unknown[];
      expect(ensures).toHaveLength(1);
      await bridge.dispose("chat-1");
    } finally {
      cleanup();
    }
  });

  it("detach removes the WS but does NOT kill or drain", async () => {
    const { opts, cleanup, tmux } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      bridge.detach("chat-1", ws);
      const kills = (tmux as any).__calls.kill as unknown[];
      expect(kills).toHaveLength(0);
      await bridge.dispose("chat-1");
    } finally {
      cleanup();
    }
  });

  it("hasSession delegates to tmux.exists, not an in-memory map", async () => {
    const { opts, cleanup, tmux } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ok = await bridge.hasSession("any-id");
      expect(ok).toBe(true);
      const calls = (tmux as any).__calls.exists as string[];
      expect(calls).toContain("any-id");
    } finally {
      cleanup();
    }
  });

  it("dispose: kills tmux, removes chat state, subsequent dispose is a no-op", async () => {
    const { opts, cleanup, tmux } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      await bridge.dispose("chat-1");
      const kills = (tmux as any).__calls.kill as string[];
      expect(kills).toContain("chat-1");
      // Re-dispose is a no-op (no throw).
      await bridge.dispose("chat-1");
    } finally {
      cleanup();
    }
  });

  it("tail picks up an appended JSONL line and emits an item-append to attached clients", async () => {
    const { opts, cleanup, tailRoot } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      // Place a transcript line into the expected file path
      // (`<tailRoot>/<encodedCwd>/<sessionId>.jsonl`).
      const encodedCwd = "-tmp-cwd-chat-1";
      mkdirSync(join(tailRoot, encodedCwd), { recursive: true });
      const sessionId = "sess-chat-1";
      const filePath = join(tailRoot, encodedCwd, `${sessionId}.jsonl`);
      writeFileSync(
        filePath,
        JSON.stringify({
          type: "user",
          uuid: "u-1",
          timestamp: "2026-05-23T00:00:00.000Z",
          message: { role: "user", content: "hello tail" },
        }) + "\n",
        "utf8",
      );
      // Wait for the poller to fire — tail polls at 25ms in test mode.
      await new Promise((r) => setTimeout(r, 200));
      const appendFrames = ws.sent
        .map((s) => JSON.parse(s))
        .filter((f) => f.kind === "item-append");
      expect(appendFrames.length).toBeGreaterThanOrEqual(1);
      await bridge.dispose("chat-1");
    } finally {
      cleanup();
    }
  });

  it("no drain timer: no setTimeout fires on detach", async () => {
    const { opts, cleanup } = freshOpts();
    const spy = vi.spyOn(global, "setTimeout");
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      spy.mockClear();
      bridge.detach("chat-1", ws);
      // No long-delay timers added by detach. (Poll timers are set by tail at
      // start time — measured BEFORE the spy was cleared.)
      const longTimers = spy.mock.calls.filter(([, ms]) => typeof ms === "number" && (ms as number) > 100);
      expect(longTimers).toHaveLength(0);
      await bridge.dispose("chat-1");
    } finally {
      spy.mockRestore();
      cleanup();
    }
  });
});
