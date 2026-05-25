/**
 * T-023 — JsonlTailBridge runtime-unavailable behaviour.
 *
 * When the underlying tmux binary is unavailable, the bridge must:
 *   - NOT crash the process.
 *   - Send a typed runtime-unavailable error frame to the ws client.
 *   - NOT register the chat in its internal map.
 *   - Report `hasSession === false`.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonlTailBridge,
  type JsonlTailBridgeOptions,
} from "../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import { TmuxUnavailableError } from "../src/process-manager/tmux-availability.ts";
import type { SessionIdStore, SessionEntry } from "../src/process-manager/session-store.ts";
import type {
  JsonlPathProbe,
  ResolvedTailRoot,
} from "../src/process-manager/jsonl-path-probe.ts";

function mkUnavailableTmux(): TmuxSessionApi {
  return {
    async ensure() {
      throw new TmuxUnavailableError(
        "tmux: binary not found (ENOENT). Install tmux >= 3.0 and ensure it is on PATH.",
      );
    },
    async kill() {
      // Idempotent no-op when unavailable.
    },
    async sendInput() {
      throw new TmuxUnavailableError("tmux unavailable");
    },
    async interrupt() {
      throw new TmuxUnavailableError("tmux unavailable");
    },
    async exists() {
      return false;
    },
  };
}

function mkStore(): SessionIdStore {
  const map: Record<string, SessionEntry> = {};
  return {
    async get(chatId) {
      return map[chatId];
    },
    async getOrCreate(chatId, cwd) {
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
      delete map[chatId];
    },
    async upsert(chatId, sessionId, cwd) {
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

function freshOpts(): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-runtime-unavail-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const opts: JsonlTailBridgeOptions = {
    tmux: mkUnavailableTmux(),
    sessionStore: mkStore(),
    pathProbe: mkProbe(tailRoot),
    paneProcess: {
      async paneRootPid() {
        return 12345;
      },
      async paneOwnsFile() {
        return true;
      },
    },
    cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
    tailPollingMs: 25,
  };
  return {
    opts,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
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

describe("JsonlTailBridge — runtime-unavailable behaviour (T-023)", () => {
  it("attach: sends a runtime-unavailable error frame instead of throwing past the bridge boundary", async () => {
    const { opts, cleanup } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      // A frame must have been sent.
      expect(ws.sent.length).toBeGreaterThan(0);
      const frames = ws.sent.map((s) => JSON.parse(s));
      const errFrame = frames.find((f) => f.kind === "error");
      expect(errFrame).toBeDefined();
      expect(errFrame.body.code).toBe("runtime-unavailable");
      expect(errFrame.body.details?.reason).toBe("tmux");
      expect(errFrame["chat-id"]).toBe("chat-1");
    } finally {
      cleanup();
    }
  });

  it("attach: does NOT register the chat in the bridge map when tmux unavailable", async () => {
    const { opts, cleanup } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      // hasSession delegates to tmux.exists, which returns false.
      const has = await bridge.hasSession("chat-1");
      expect(has).toBe(false);
      // A second attach attempt should also send another error frame
      // (no cached "live" state was created).
      const ws2 = makeWs();
      await bridge.attach("chat-1", ws2);
      const frames2 = ws2.sent.map((s) => JSON.parse(s));
      const err2 = frames2.find((f) => f.kind === "error");
      expect(err2?.body.code).toBe("runtime-unavailable");
    } finally {
      cleanup();
    }
  });

  it("submitUserTurnWithPriority: swallows TmuxUnavailableError (no unhandled rejection past the bridge)", async () => {
    // Real-world flow: a user can't `user-turn` for a chat that has not
    // been successfully attached. The HTTP-WS handler fires user-turn
    // as fire-and-forget (no await, no catch), so any throw past the
    // bridge would become an unhandled rejection. This test pins the
    // "no throw past the bridge" contract; the runtime-unavailable
    // signalling lives on the attach path (where the ws IS bound to
    // the chat state).
    const { opts, cleanup } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      // No attach. user-turn arrives standalone (defensive contract).
      await expect(
        bridge.submitUserTurnWithPriority("chat-1", "hello"),
      ).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("interrupt: swallows TmuxUnavailableError (no unhandled rejection past the bridge)", async () => {
    const { opts, cleanup } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      await expect(bridge.interrupt("chat-1")).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
