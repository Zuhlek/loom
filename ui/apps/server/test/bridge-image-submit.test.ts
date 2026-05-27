/**
 * T-003 — Bridge stages a turn's images and appends @<path> tokens to the
 * tmux send, surfacing a typed error frame on staging failure (US-001, US-002).
 *
 * Inject a fake image store + a recording fake tmux; behaviour-level only.
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
import {
  StageImageError,
  type ImageStore,
  type StagedImage,
} from "../src/process-manager/jsonl/image-store.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore, SessionEntry } from "../src/process-manager/session-store.ts";
import type { JsonlPathProbe, ResolvedTailRoot } from "../src/process-manager/jsonl-path-probe.ts";

function mkTmuxRec(): {
  api: TmuxSessionApi;
  calls: { sendInput: { chatId: string; text: string }[] };
} {
  const calls = { sendInput: [] as { chatId: string; text: string }[] };
  const api: TmuxSessionApi = {
    async ensure() {},
    async kill() {},
    async sendInput(chatId, text) {
      calls.sendInput.push({ chatId, text });
    },
    async sendKey() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  return { api, calls };
}

function mkOpts(
  tmux: TmuxSessionApi,
  imageStore?: ImageStore,
): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bridge-image-"));
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
      imageStore,
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

/** Image store that stages successfully, returning the given absolute paths. */
function stubStore(absPaths: string[]): ImageStore {
  return {
    async stageTurnImages(): Promise<StagedImage[]> {
      return absPaths.map((absPath) => ({ absPath, mediaType: "image/png" }));
    },
    lookupByPath() {
      return undefined;
    },
  };
}

/** Image store that always fails staging with a typed error. */
function failingStore(reason: "decode" | "mime" | "write" = "decode"): ImageStore {
  return {
    async stageTurnImages(): Promise<StagedImage[]> {
      throw new StageImageError(reason, `staging failed: ${reason}`);
    },
    lookupByPath() {
      return undefined;
    },
  };
}

describe("JsonlTailBridge — image submit (T-003)", () => {
  it("stages images and appends a single space-joined @<path> run to the tmux text", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(
      api,
      stubStore(["/abs/a.png", "/abs/b.jpg"]),
    );
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.submitUserTurnWithPriority("c-1", "hello", "now", [
        { mediaType: "image/png", dataB64: "x" },
        { mediaType: "image/jpeg", dataB64: "y" },
      ]);
      expect(calls.sendInput).toEqual([
        { chatId: "c-1", text: "hello @/abs/a.png @/abs/b.jpg" },
      ]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("leaves the text unchanged and does not stage when there are no images", async () => {
    const { api, calls } = mkTmuxRec();
    let staged = false;
    const watchStore: ImageStore = {
      async stageTurnImages() {
        staged = true;
        return [];
      },
      lookupByPath() {
        return undefined;
      },
    };
    const { opts, cleanup } = mkOpts(api, watchStore);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      await bridge.submitUserTurnWithPriority("c-1", "plain text", "now");
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "plain text" }]);
      expect(staged).toBe(false);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("on StageImageError broadcasts exactly one typed error frame AND still sends the text", async () => {
    const { api, calls } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api, failingStore("decode"));
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.submitUserTurnWithPriority("c-1", "look at this", "now", [
        { mediaType: "image/png", dataB64: "broken" },
      ]);
      // Text is never lost — sent without any @<path> token.
      expect(calls.sendInput).toEqual([{ chatId: "c-1", text: "look at this" }]);
      const frames = ws.sent.map((s) => JSON.parse(s));
      const errors = frames.filter((f) => f.kind === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]["chat-id"]).toBe("c-1");
      expect(typeof errors[0].body.message).toBe("string");
      expect(errors[0].body.message.length).toBeGreaterThan(0);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("never broadcasts the legacy 'not supported by the JSONL bridge' message for an image turn", async () => {
    const { api } = mkTmuxRec();
    const { opts, cleanup } = mkOpts(api, stubStore(["/abs/a.png"]));
    try {
      const bridge = createJsonlTailBridge(opts);
      const ws = makeWs();
      await bridge.attach("c-1", ws);
      ws.sent.length = 0;
      await bridge.submitUserTurnWithPriority("c-1", "hi", "now", [
        { mediaType: "image/png", dataB64: "x" },
      ]);
      const joined = ws.sent.join("\n");
      expect(joined).not.toMatch(/not supported by the JSONL bridge/i);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
