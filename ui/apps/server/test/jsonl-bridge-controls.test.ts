/**
 * T-011 — Bridge plan/permission-mode/model/retry methods.
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
import type { SessionIdStore } from "../src/process-manager/session-store.ts";
import type { JsonlPathProbe, ResolvedTailRoot } from "../src/process-manager/jsonl-path-probe.ts";

interface TmuxCalls {
  sendInput: { chatId: string; text: string }[];
  ensure: number;
  kill: number;
}

function mkTmuxRec(): { api: TmuxSessionApi; calls: TmuxCalls } {
  const calls: TmuxCalls = { sendInput: [], ensure: 0, kill: 0 };
  const api: TmuxSessionApi = {
    async ensure() {
      calls.ensure++;
    },
    async kill() {
      calls.kill++;
    },
    async sendInput(chatId, text) {
      calls.sendInput.push({ chatId, text });
    },
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function mkOpts(tmux: TmuxSessionApi): { opts: JsonlTailBridgeOptions; cleanup: () => void; storeDeletes: string[] } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-ctrl-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const storeDeletes: string[] = [];
  let seq = 0;
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
    async getOrCreate(chatId, cwd) {
      return { sessionId: `sess-${chatId}-${++seq}`, cwd, createdAt: "x" };
    },
    async delete(chatId) {
      storeDeletes.push(chatId);
    },
    async upsert(chatId, sessionId, cwd) {
      return { sessionId, cwd: cwd ?? "", createdAt: "x" };
    },
    async findByClaudeSessionId() {
      return undefined;
    },
  };
  const probe: JsonlPathProbe = {
    async resolve(): Promise<ResolvedTailRoot> {
      return {
        tailRoot,
        encodingScheme: "cwd-slash-encoded",
        resolvedAt: "x",
        claudeVersionAtProbe: "test",
      };
    },
    async reprobe() {
      return this.resolve();
    },
    encodeCwd: (c) => c.replace(/\//g, "-"),
  };
  return {
    opts: {
      tmux,
      sessionStore: store,
      pathProbe: probe,
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
      cwdResolver: async (c) => `/tmp/${c}`,
      tailPollingMs: 25,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    storeDeletes,
  };
}

function makeWs(): WsClient & { sent: string[] } {
  const sent: string[] = [];
  return { sent, send: (t) => sent.push(t) };
}

describe("JsonlTailBridge — control surface (T-011)", () => {
  it("setPermissionMode does NOT call tmux.kill/ensure (in-process only) but broadcasts the mode frame", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      const ensuresBefore = calls.ensure;
      await bridge.setPermissionMode("c-1", "plan");
      // ensure was already called by attach; setPermissionMode does NOT call ensure again past initialization.
      expect(calls.ensure).toBe(ensuresBefore);
      expect(calls.kill).toBe(0);
      const frames = ws.sent.map((s) => JSON.parse(s));
      const pm = frames.find((f) => f.kind === "permission-mode-set");
      expect(pm?.body?.mode).toBe("plan");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("acceptPlanProposal sends the literal accept choice via the user-input path", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.acceptPlanProposal("c-1", "plan-x");
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "1" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("rejectPlanProposal sends the literal reject choice", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.rejectPlanProposal("c-1", "plan-x");
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "2" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setModelSettings translates the patch into a /model slash-command literal", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.setModelSettings("c-1", { model: "opus", effort: "high", contextWindow: "200k", thinking: null });
      expect(calls.sendInput.length).toBe(1);
      const sent = calls.sendInput[0]!;
      expect(sent.chatId).toBe("c-1");
      expect(sent.text.startsWith("/model")).toBe(true);
      expect(sent.text).toContain("opus");
      expect(sent.text).toContain("--effort=high");
      expect(sent.text).toContain("--context=200k");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("retrySession kills tmux + deletes the sessionStore entry + emits a fresh snapshot", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup, storeDeletes } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.retrySession("c-1");
      expect(calls.kill).toBeGreaterThanOrEqual(1);
      expect(storeDeletes).toContain("c-1");
      const frames = ws.sent.map((s) => JSON.parse(s));
      const snap = frames.find((f) => f.kind === "snapshot");
      expect(snap).toBeDefined();
      expect(snap.body.items).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
