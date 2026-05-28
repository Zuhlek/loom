/**
 * T-013 — Bridge as hook-receiver EnvelopeBroadcaster owner.
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
import { makeEnvelope } from "../src/chat-protocol/envelope.ts";

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

function mkOpts(): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-hook-"));
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
        gateDegraded() {
          return false;
        },
      },
      cwdResolver: async (c) => `/tmp/${c}`,
      tailPollingMs: 25,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeWs(): WsClient & { sent: string[] } {
  const sent: string[] = [];
  return { sent, send: (t) => sent.push(t) };
}

describe("JsonlTailBridge — routeHookEnvelope (T-013)", () => {
  it("PermissionRequest envelope inserts a PendingPermission + emits pending-permission frame", async () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "permissionrequest",
          data: { id: "p-1", toolName: "Bash", input: { command: "ls" } },
        }),
      );
      const frames = ws.sent.map((s) => JSON.parse(s));
      const pp = frames.find((f) => f.kind === "pending-permission");
      expect(pp).toBeDefined();
      expect(pp.body.id).toBe("p-1");
      expect(pp.body.toolName).toBe("Bash");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("AskUserQuestion envelope inserts a PendingQuestion + emits pending-question frame", async () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "askuserquestion",
          data: {
            id: "q-1",
            question: "do the thing?",
            options: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }],
          },
        }),
      );
      const frames = ws.sent.map((s) => JSON.parse(s));
      const pq = frames.find((f) => f.kind === "pending-question");
      expect(pq).toBeDefined();
      expect(pq.body.id).toBe("q-1");
      expect(pq.body.options).toHaveLength(2);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("SessionStart yields a session-state frame; Stop yields a turn-state frame", async () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      bridge.routeHookEnvelope(makeEnvelope("session-start", "c-1", { sessionId: "s" }));
      bridge.routeHookEnvelope(makeEnvelope("stop", "c-1", { kind: "Stop" }));
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "session-state")).toBeDefined();
      expect(frames.find((f) => f.kind === "turn-state")).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("unknown chat-id: routeHookEnvelope drops silently (no throw)", () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      expect(() =>
        bridge.routeHookEnvelope(
          makeEnvelope("gate-pending", "no-such-chat", {
            kind: "permissionrequest",
            data: { id: "p", toolName: "Bash" },
          }),
        ),
      ).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it("dispose removes pending-permissions; subsequent envelopes are treated as unknown chat-id", async () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "permissionrequest",
          data: { id: "p-1", toolName: "Bash" },
        }),
      );
      await bridge.dispose("c-1");
      const initialSentLen = ws.sent.length;
      // Routing for the disposed chat must not broadcast.
      bridge.routeHookEnvelope(
        makeEnvelope("gate-pending", "c-1", {
          kind: "permissionrequest",
          data: { id: "p-2", toolName: "Bash" },
        }),
      );
      expect(ws.sent.length).toBe(initialSentLen);
    } finally {
      cleanup();
    }
  });

  it("pre-tool-use envelope → pending-permission (T-014 gate-positive path)", async () => {
    const { opts, cleanup } = mkOpts();
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      bridge.routeHookEnvelope(
        makeEnvelope("pre-tool-use", "c-1", {
          toolName: "Bash",
          payload: { id: "pre-1", input: { command: "ls" }, toolUseId: "tu" },
        }),
      );
      const frames = ws.sent.map((s) => JSON.parse(s));
      const pp = frames.find((f) => f.kind === "pending-permission");
      expect(pp).toBeDefined();
      expect(pp.body.id).toBe("pre-1");
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
