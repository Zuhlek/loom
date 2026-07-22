/**
 * Shared mock factories for the jsonl-bridge test suites. One canonical
 * recording fake per bridge dependency; individual suites override single
 * methods via the `overrides` parameter instead of re-rolling the factory.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonlTailBridgeOptions, WsClient } from "../../src/process-manager/jsonl/bridge.ts";
import type { TmuxSessionApi } from "../../src/process-manager/tmux-session.ts";
import type { PaneProcessApi } from "../../src/process-manager/pane-process.ts";
import type { SessionEntry, SessionIdStore } from "../../src/process-manager/session-store.ts";

export interface TmuxCalls {
  ensure: { chatId: string; cwd: string; sessionId: string }[];
  kill: string[];
  sendInput: { chatId: string; text: string }[];
  sendKey: { chatId: string; key: string }[];
  interrupt: string[];
  exists: string[];
}

/** Recording tmux fake. Every call is captured in `.calls`; behaviour is overridable per method. */
export function mkTmux(
  overrides: Partial<TmuxSessionApi> = {},
): TmuxSessionApi & { calls: TmuxCalls } {
  const calls: TmuxCalls = {
    ensure: [],
    kill: [],
    sendInput: [],
    sendKey: [],
    interrupt: [],
    exists: [],
  };
  return {
    calls,
    async ensure(chatId, cwd, sessionId) {
      calls.ensure.push({ chatId, cwd, sessionId });
      await overrides.ensure?.(chatId, cwd, sessionId);
    },
    async kill(chatId) {
      calls.kill.push(chatId);
      await overrides.kill?.(chatId);
    },
    async sendInput(chatId, text) {
      calls.sendInput.push({ chatId, text });
      await overrides.sendInput?.(chatId, text);
    },
    async sendKey(chatId, key) {
      calls.sendKey.push({ chatId, key });
      await overrides.sendKey?.(chatId, key);
    },
    async interrupt(chatId) {
      calls.interrupt.push(chatId);
      await overrides.interrupt?.(chatId);
    },
    async exists(chatId) {
      calls.exists.push(chatId);
      return overrides.exists ? overrides.exists(chatId) : true;
    },
  };
}

export interface StoreCalls {
  getOrCreate: { chatId: string; cwd: string }[];
  delete: string[];
  upsert: { chatId: string; sessionId: string; cwd?: string }[];
}

/** In-memory SessionIdStore fake over a plain record. */
export function mkStore(
  map: Record<string, SessionEntry> = {},
): SessionIdStore & { calls: StoreCalls; map: Record<string, SessionEntry> } {
  const calls: StoreCalls = { getOrCreate: [], delete: [], upsert: [] };
  return {
    calls,
    map,
    async getOrCreate(chatId, cwd) {
      calls.getOrCreate.push({ chatId, cwd });
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
      calls.delete.push(chatId);
      delete map[chatId];
    },
    async upsert(chatId, sessionId, cwd) {
      calls.upsert.push({ chatId, sessionId, cwd });
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

/** Permissive pane-process fake: the pane always owns the file. */
export function mkPaneProcess(overrides: Partial<PaneProcessApi> = {}): PaneProcessApi {
  return {
    async paneRootPid() {
      return 12345;
    },
    async paneOwnsFile() {
      return true;
    },
    gateDegraded() {
      return false;
    },
    ...overrides,
  };
}

/** Recording WsClient. */
export function makeWs(): WsClient & { sent: string[] } {
  return {
    sent: [] as string[],
    send(text: string) {
      this.sent.push(text);
    },
  };
}

export interface FreshOpts {
  opts: JsonlTailBridgeOptions;
  cleanup: () => void;
  tailRoot: string;
  tmux: ReturnType<typeof mkTmux>;
  store: ReturnType<typeof mkStore>;
}

/**
 * Bridge options against a tmpdir tailRoot with fast polling. Override any
 * option (or swap the tmux/store fakes) via `overrides`.
 */
export function freshOpts(overrides: Partial<JsonlTailBridgeOptions> = {}): FreshOpts {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-test-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const tmux = mkTmux();
  const store = mkStore();
  const opts: JsonlTailBridgeOptions = {
    tmux,
    sessionStore: store,
    tailRoot,
    paneProcess: mkPaneProcess(),
    cwdResolver: async (chatId) => `/tmp/cwd-${chatId}`,
    tailPollingMs: 25,
    ...overrides,
  };
  return {
    opts,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    tailRoot,
    tmux: (opts.tmux as ReturnType<typeof mkTmux>) ?? tmux,
    store: (opts.sessionStore as ReturnType<typeof mkStore>) ?? store,
  };
}
