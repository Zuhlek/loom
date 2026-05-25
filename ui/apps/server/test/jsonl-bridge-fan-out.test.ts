/**
 * T-012 — Bridge onTasksUpdate listener registry + WS fan-out.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

function mkTmux(): TmuxSessionApi {
  return {
    async ensure() {},
    async kill() {},
    async sendInput() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
}

function mkOpts(): { opts: JsonlTailBridgeOptions; cleanup: () => void; tailRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-fanout-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
    async getOrCreate(chatId, cwd) {
      return { sessionId: `sess-${chatId}`, cwd, createdAt: "x" };
    },
    async delete() {},
    async upsert(_chatId, sessionId, cwd) {
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
      tmux: mkTmux(),
      sessionStore: store,
      pathProbe: probe,
      paneProcess: {
        async paneRootPid() {
          return 12345;
        },
        async paneOwnsFile() {
          return true;
        },
      },
      cwdResolver: async (c) => `/tmp/${c}`,
      tailPollingMs: 25,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    tailRoot,
  };
}

function makeWs(): WsClient & { sent: string[] } {
  const sent: string[] = [];
  return { sent, send: (t) => sent.push(t) };
}

function appendTaskCreateLine(tailRoot: string, chatId: string): void {
  const encoded = `-tmp-${chatId}`;
  mkdirSync(join(tailRoot, encoded), { recursive: true });
  const file = join(tailRoot, encoded, `sess-${chatId}.jsonl`);
  const line = JSON.stringify({
    type: "assistant",
    uuid: "tc-1",
    timestamp: "2026-05-23T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "TaskCreate",
          input: { subject: "a", activeForm: "Doing a" },
        },
      ],
    },
  });
  writeFileSync(file, line + "\n", "utf8");
}

describe("JsonlTailBridge — fan-out + onTasksUpdate (T-012)", () => {
  it("onTasksUpdate: both listeners fire on a task_update event", async () => {
    const { opts, cleanup, tailRoot } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      const calls1: { chatId: string; tasks: unknown }[] = [];
      const calls2: { chatId: string; tasks: unknown }[] = [];
      bridge.onTasksUpdate((chatId, tasks) => calls1.push({ chatId, tasks }));
      bridge.onTasksUpdate((chatId, tasks) => calls2.push({ chatId, tasks }));
      appendTaskCreateLine(tailRoot, "c-1");
      await new Promise((r) => setTimeout(r, 250));
      expect(calls1.length).toBeGreaterThanOrEqual(1);
      expect(calls2.length).toBeGreaterThanOrEqual(1);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("onTasksUpdate: returned unsubscribe removes the listener", async () => {
    const { opts, cleanup, tailRoot } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      const calls: unknown[] = [];
      const off = bridge.onTasksUpdate(() => calls.push("hit"));
      off();
      appendTaskCreateLine(tailRoot, "c-1");
      await new Promise((r) => setTimeout(r, 250));
      expect(calls).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("WS fan-out: every attached client receives every frame", async () => {
    const { opts, cleanup, tailRoot } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const wsA = makeWs();
      const wsB = makeWs();
      const wsC = makeWs();
      await bridge.attach("c-1", wsA);
      await bridge.attach("c-1", wsB);
      await bridge.attach("c-1", wsC);
      // Capture only frames generated after the snapshots.
      wsA.sent.length = 0;
      wsB.sent.length = 0;
      wsC.sent.length = 0;
      appendTaskCreateLine(tailRoot, "c-1");
      await new Promise((r) => setTimeout(r, 250));
      const aFrames = wsA.sent.map((s) => JSON.parse(s));
      const bFrames = wsB.sent.map((s) => JSON.parse(s));
      const cFrames = wsC.sent.map((s) => JSON.parse(s));
      expect(aFrames.find((f) => f.kind === "tasks-update")).toBeDefined();
      expect(bFrames.find((f) => f.kind === "tasks-update")).toBeDefined();
      expect(cFrames.find((f) => f.kind === "tasks-update")).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("slow client whose send throws does not block delivery to others", async () => {
    const { opts, cleanup, tailRoot } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const goodWs = makeWs();
      const badWs: WsClient & { sent: string[] } = {
        sent: [],
        send() {
          throw new Error("boom");
        },
      };
      await bridge.attach("c-1", badWs);
      await bridge.attach("c-1", goodWs);
      goodWs.sent.length = 0;
      appendTaskCreateLine(tailRoot, "c-1");
      await new Promise((r) => setTimeout(r, 250));
      const goodFrames = goodWs.sent.map((s) => JSON.parse(s));
      expect(goodFrames.find((f) => f.kind === "tasks-update")).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
