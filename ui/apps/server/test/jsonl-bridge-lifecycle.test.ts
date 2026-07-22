/**
 * T-009 — JsonlTailBridge lifecycle (attach / detach / hasSession / dispose).
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJsonlTailBridge } from "../src/process-manager/jsonl/bridge.ts";
import { freshOpts, makeWs } from "./helpers/bridge-mocks.ts";

describe("JsonlTailBridge lifecycle", () => {
  it("first attach: triggers sessionStore.getOrCreate + tmux.ensure + opens tail", async () => {
    const { opts, cleanup, tmux, store } = freshOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("chat-1", ws);
      const ensures = tmux.calls.ensure as unknown[];
      const creates = store.calls.getOrCreate as unknown[];
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
      const ensures = tmux.calls.ensure as unknown[];
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
      const kills = tmux.calls.kill as unknown[];
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
      const calls = tmux.calls.exists as string[];
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
      const kills = tmux.calls.kill as string[];
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
