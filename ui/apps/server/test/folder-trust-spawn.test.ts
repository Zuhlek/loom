import { describe, it, expect } from "vitest";
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
import type {
  JsonlPathProbe,
  ResolvedTailRoot,
} from "../src/process-manager/jsonl-path-probe.ts";
import type { WirePermissionMode } from "../src/chat-protocol/frames.ts";

function mkOpts(
  mode: WirePermissionMode,
  trustedCwds: string[],
): { opts: JsonlTailBridgeOptions; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "folder-trust-spawn-"));
  const tailRoot = join(root, "projects");
  mkdirSync(tailRoot, { recursive: true });

  const tmux: TmuxSessionApi = {
    async ensure() {},
    async kill() {},
    async sendInput() {},
    async sendKey() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  const store: SessionIdStore = {
    async get() {
      return undefined;
    },
    async getOrCreate(chatId, cwd): Promise<SessionEntry> {
      return { sessionId: `sess-${chatId}`, cwd, createdAt: "2026-01-01T00:00:00.000Z" };
    },
    async delete() {},
    async upsert(_c, sessionId, cwd): Promise<SessionEntry> {
      return { sessionId, cwd: cwd ?? "", createdAt: "2026-01-01T00:00:00.000Z" };
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
        resolvedAt: "2026-01-01T00:00:00.000Z",
        claudeVersionAtProbe: "test",
      };
    },
    async reprobe() {
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
          return 1;
        },
        async paneOwnsFile() {
          return true;
        },
        gateDegraded() {
          return false;
        },
      },
      cwdResolver: async (chatId) => `/work/${chatId}`,
      permissionModeResolver: () => mode,
      tailPollingMs: 25,
      ensureFolderTrusted: (cwd) => {
        trustedCwds.push(cwd);
      },
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeWs(): WsClient {
  return { send() {} };
}

describe("bridge — folder-trust pre-seed on spawn (F4)", () => {
  it("calls ensureFolderTrusted with the resolved cwd for a bypassPermissions spawn", async () => {
    const trusted: string[] = [];
    const { opts, cleanup } = mkOpts("bypassPermissions", trusted);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      expect(trusted).toEqual(["/work/c-1"]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });

  it("does NOT seed trust for a non-bypass (default) spawn", async () => {
    const trusted: string[] = [];
    const { opts, cleanup } = mkOpts("default", trusted);
    try {
      const bridge = createJsonlTailBridge(opts);
      await bridge.attach("c-1", makeWs());
      expect(trusted).toEqual([]);
      await bridge.dispose("c-1");
    } finally {
      cleanup();
    }
  });
});
