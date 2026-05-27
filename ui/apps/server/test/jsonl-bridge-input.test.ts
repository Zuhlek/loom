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
import type { JsonlPathProbe, ResolvedTailRoot } from "../src/process-manager/jsonl-path-probe.ts";
import { makeEnvelope } from "../src/chat-protocol/envelope.ts";

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

function mkOpts(tmux: TmuxSessionApi): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "jsonl-bridge-input-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
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
  const probe: JsonlPathProbe = {
    async resolve(): Promise<ResolvedTailRoot> {
      return {
        tailRoot,
        encodingScheme: "cwd-slash-encoded",
        resolvedAt: "2026-01-01T00:00:00.000Z",
        claudeVersionAtProbe: "test",
      };
    },
    async reprobe(): Promise<ResolvedTailRoot> {
      return this.resolve();
    },
    encodeCwd(cwd) {
      return cwd.replace(/\//g, "-");
    },
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
      },
      cwdResolver: async (chatId) => `/tmp/${chatId}`,
      tailPollingMs: 25,
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
  it("submitUserTurnWithPriority calls tmux.sendInput exactly once with the text", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.submitUserTurnWithPriority("c-1", "hello", "now");
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "hello" }]);
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

  it("respondToPermission(allow) sends the literal accept choice + clears pending-permission", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.respondToPermission("c-1", "perm-1", "allow", {});
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "1" }]);
      const frames = ws.sent.map((s) => JSON.parse(s));
      expect(frames.find((f) => f.kind === "pending-permission" && f.body === null)).toBeDefined();
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission(deny) sends the literal reject choice", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.respondToPermission("c-1", "perm-1", "deny", {});
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "2" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission emits a permission-resolved frame carrying the original id + the user's behavior verb (N1)", async () => {
    // Spec §US-003 AC5 / §US-009 AC3 mandate a `permission-resolved`
    // acknowledgement frame after the response reaches tmux. The body
    // must carry the original prompt-id plus the user's choice
    // (`"allow"` / `"deny"`) so clients can audit which prompt was
    // resolved and how.
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
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
      // Ordering: the literal choice reaches tmux BEFORE the resolved
      // frame is broadcast (the frame is post-tmux per spec wording).
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "1" }]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("respondToPermission(deny) emits permission-resolved with behavior:\"deny\"", async () => {
    const { api } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api);
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

  it("submitUserTurnWithPriority(images): stages via the image store and appends @<path> to the text", async () => {
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
      ws.sent.length = 0;
      await bridge.submitUserTurnWithPriority("c-1", "with image", "now", [
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
