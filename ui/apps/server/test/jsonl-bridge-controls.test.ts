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
import type { ChatRow } from "../src/metadata-store/repos/chat.ts";

function stubChatRow(chatId: string, mode: ChatRow["permission_mode"]): ChatRow {
  return {
    id: chatId,
    project_id: null,
    cwd: `/tmp/${chatId}`,
    permission_mode: mode,
    worktree_mode: null,
    worktree_path: null,
    session_id: null,
    pid: null,
    last_opened: "x",
    pinned: false,
    resume_banner_dismissed: false,
    inert: false,
    created_at: "x",
    custom_name: null,
    model_settings: null,
    branch: null,
    vcs_kind: null,
  };
}

interface TmuxCalls {
  sendInput: { chatId: string; text: string }[];
  sendKey: { chatId: string; key: string }[];
  ensure: number;
  kill: number;
}

function mkTmuxRec(): { api: TmuxSessionApi; calls: TmuxCalls } {
  const calls: TmuxCalls = { sendInput: [], sendKey: [], ensure: 0, kill: 0 };
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
    async sendKey(chatId, key) {
      calls.sendKey.push({ chatId, key });
    },
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function mkOpts(
  tmux: TmuxSessionApi,
  extra?: { persistPermissionMode?: JsonlTailBridgeOptions["persistPermissionMode"] },
): { opts: JsonlTailBridgeOptions; cleanup: () => void; storeDeletes: string[] } {
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
      persistPermissionMode: extra?.persistPermissionMode,
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
  it("setPermissionMode cycles Shift-Tab to reach the target, persists the row, and broadcasts the confirmation + chat-update frames", async () => {
    const { api, calls } = mkTmuxRec();
    const persisted: { chatId: string; mode: string }[] = [];
    const { opts, cleanup } = mkOpts(api, {
      persistPermissionMode: (chatId, mode) => {
        persisted.push({ chatId, mode });
        return stubChatRow(chatId, mode);
      },
    });
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      const ensuresBefore = calls.ensure;
      // default -> plan is 2 BTab steps in claude's TUI cycle.
      await bridge.setPermissionMode("c-1", "plan");
      expect(calls.ensure).toBe(ensuresBefore);
      expect(calls.kill).toBe(0);
      expect(calls.sendKey.filter((k) => k.key === "BTab")).toHaveLength(2);
      expect(calls.sendKey.every((k) => k.chatId === "c-1")).toBe(true);
      expect(persisted).toEqual([{ chatId: "c-1", mode: "plan" }]);
      const frames = ws.sent.map((s) => JSON.parse(s));
      const pm = frames.find((f) => f.kind === "permission-mode-set");
      expect(pm?.body?.mode).toBe("plan");
      const cu = frames.find((f) => f.kind === "chat-update");
      expect(cu?.body?.chat?.permission_mode).toBe("plan");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setPermissionMode from plan -> default uses a single Shift-Tab (cycle wraparound)", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.setPermissionMode("c-1", "plan");
      const before = calls.sendKey.length;
      await bridge.setPermissionMode("c-1", "default");
      expect(calls.sendKey.length - before).toBe(1);
      expect(calls.sendKey[calls.sendKey.length - 1]!.key).toBe("BTab");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setPermissionMode(bypassPermissions) skips keystrokes and emits an error frame explaining the next-session constraint", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api, {
      persistPermissionMode: () => stubChatRow("c-1", "bypassPermissions"),
    });
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.setPermissionMode("c-1", "bypassPermissions");
      expect(calls.sendKey).toHaveLength(0);
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "permission-mode-set")?.body?.mode).toBe(
        "bypassPermissions",
      );
      expect(frames.find((f) => f.kind === "error")).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setPermissionMode out of bypassPermissions skips keystrokes and emits an error frame (claude's cycle does not include bypass)", async () => {
    const { api, calls } = mkTmuxRec();
    const persisted: { chatId: string; mode: string }[] = [];
    const { opts, cleanup } = mkOpts(api, {
      persistPermissionMode: (chatId, mode) => {
        persisted.push({ chatId, mode });
        return stubChatRow(chatId, mode);
      },
    });
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      await bridge.setPermissionMode("c-1", "bypassPermissions");
      ws.sent.length = 0;
      const keysBefore = calls.sendKey.length;
      await bridge.setPermissionMode("c-1", "default");
      expect(calls.sendKey.length - keysBefore).toBe(0);
      expect(persisted.map((p) => p.mode)).toContain("default");
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "permission-mode-set")?.body?.mode).toBe(
        "default",
      );
      expect(frames.find((f) => f.kind === "error")).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setPermissionMode rolls back in-memory + persisted state and broadcasts a corrective frame when a mid-cycle keystroke fails", async () => {
    const { api, calls } = mkTmuxRec();
    let failNextKey = false;
    const baseSendKey = api.sendKey;
    api.sendKey = async (chatId, key) => {
      if (failNextKey) {
        failNextKey = false;
        throw new Error("simulated tmux send-keys failure");
      }
      await baseSendKey(chatId, key);
    };
    const persisted: { chatId: string; mode: string }[] = [];
    const { opts, cleanup } = mkOpts(api, {
      persistPermissionMode: (chatId, mode) => {
        persisted.push({ chatId, mode });
        return stubChatRow(chatId, mode);
      },
    });
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      // default -> plan is 2 BTab steps; fail the 2nd by failing the first
      // sendKey we observe (the queue body fires AFTER attach has run).
      ws.sent.length = 0;
      failNextKey = true;
      await bridge.setPermissionMode("c-1", "plan");
      const frames = ws.sent.map((s) => JSON.parse(s));
      // Optimistic confirmation fired with "plan", then corrective with prev.
      const modeSetFrames = frames.filter((f) => f.kind === "permission-mode-set");
      expect(modeSetFrames.length).toBeGreaterThanOrEqual(2);
      expect(modeSetFrames[modeSetFrames.length - 1]?.body?.mode).toBe("default");
      expect(frames.find((f) => f.kind === "error")).toBeDefined();
      // Persistence: forward write to "plan" then rollback to "default".
      expect(persisted.map((p) => p.mode)).toEqual(["plan", "default"]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("setPermissionMode serializes rapid-fire spam clicks FIFO so keystrokes land in call order without interleaving", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api, {
      persistPermissionMode: (chatId, mode) => stubChatRow(chatId, mode),
    });
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      // Fire three calls without awaiting between them. Each
      // setPermissionMode awaits its own queued keystrokes at the end,
      // so Promise.all is needed to drain all three. Per-call step
      // counts are computed against state.permissionMode at call time,
      // which is mutated synchronously before the queue runs, so the
      // observed sequence reflects FIFO transitions:
      //   default -> plan        = 2 BTab (CYCLE_ORDER: default,acceptEdits,plan)
      //   plan -> acceptEdits    = 2 BTab
      //   acceptEdits -> default = 2 BTab
      const p1 = bridge.setPermissionMode("c-1", "plan");
      const p2 = bridge.setPermissionMode("c-1", "acceptEdits");
      const p3 = bridge.setPermissionMode("c-1", "default");
      await Promise.all([p1, p2, p3]);
      const keys = calls.sendKey.map((k) => k.key);
      expect(keys).toEqual(["BTab", "BTab", "BTab", "BTab", "BTab", "BTab"]);
      expect(calls.sendKey.every((k) => k.chatId === "c-1")).toBe(true);
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
