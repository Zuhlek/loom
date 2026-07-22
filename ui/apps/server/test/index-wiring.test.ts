import { describe, test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mountAllRoutes,
  createChatDiffPanelSubstrate,
} from "../src/index.ts";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { createJsonlTailBridge } from "../src/process-manager/jsonl/bridge.ts";
import type { ResolvedConfig } from "../src/config-loader/index.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore } from "../src/process-manager/session-store.ts";
import type { PaneProcessApi } from "../src/process-manager/pane-process.ts";

function fakeDeps() {
  const root = mkdtempSync(join(tmpdir(), "loom-wiring-"));
  const tmux: TmuxSessionApi = {
    async ensure() {},
    async kill() {},
    async sendInput() {},
    async interrupt() {},
    async exists() {
      return true;
    },
  };
  const sessionStore: SessionIdStore = {
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
  const paneProcess: PaneProcessApi = {
    async paneOwnsFile() {
      return true;
    },
    async pidsInPane() {
      return [];
    },
    gateDegraded() {
      return false;
    },
  };
  return { root, tmux, sessionStore, paneProcess };
}

describe("index.ts wiring (T-021)", () => {
  test("mountAllRoutes registers every chat-diff-panel route", async () => {
    const { root, tmux, sessionStore, paneProcess } = fakeDeps();
    try {
      const store = await initMetadataStore({ inMemoryOnly: true });
      const config: ResolvedConfig = {
        root,
        source: "cli",
        worktreesRoot: null,
        configPath: "/tmp/wiring-config.json",
        defaultEnvMode: "local",
      };
      const bridge = createJsonlTailBridge({
        tmux,
        sessionStore,
        tailRoot: join(root, "projects"),
        paneProcess,
        cwdResolver: () => root,
      });
      const substrate = createChatDiffPanelSubstrate(bridge, config);

      const routes: Record<
        string,
        (req: Request, url: URL) => Response | Promise<Response>
      > = {};
      mountAllRoutes(routes, {
        store,
        config,
        bridge,
        substrate,
        receiverPort: 3737,
        sessionStore,
      });

      // Every new chat-diff-panel route must be registered.
      const expected = [
        "/chats/meta",
        "/git/switchRef",
        "/git/createRef",
        "/git/createWorktree",
        "/git/removeWorktree",
        "/worktrees",
        "/worktrees/delete",
        "/source-control/list-prs",
        "/source-control/get-pr",
        "/source-control/checkout-cr",
        "/source-control/default-branch",
        "/git/pr",
        "/diff",
        "/settings",
      ];
      for (const path of expected) {
        expect(typeof routes[path], `route ${path} must be mounted`).toBe(
          "function",
        );
      }

      // M1 — /git/pr must be the provider-routed handler from
      // source-control-rpc.ts, not the deleted legacy git-actions one.
      // The provider-routed handler requires `head` in the body; the
      // legacy handler accepted only worktreePath + title. Probe by
      // sending a body without `head` — the active handler should
      // reject with "head required".
      const prReq = new Request("http://x/git/pr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/x", title: "t" }),
      });
      const prRes = await routes["/git/pr"]!(prReq, new URL(prReq.url));
      expect(prRes.status).toBe(400);
      const prBody = (await prRes.json()) as { error: string };
      expect(prBody.error).toBe("head required");

      // /diff without worktreePath returns 400 with a JSON error body —
      // proving the (now dependency-free) diff handler is mounted.
      const url = "http://x/diff";
      const res = await routes["/diff"]!(new Request(url), new URL(url));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("missing worktreePath");

      // Disposal — substrate's head-watcher had no cwd to watch in this
      // tmpdir (no `.git`), but disposing should be safe regardless.
      substrate.headWatcherSubscription?.unsubscribe();
      substrate.headWatcher.dispose();
      await store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("JsonlTailBridge exposes broadcastFrameToChat + broadcastFrameToAll", () => {
    const { tmux, sessionStore, paneProcess, root } = fakeDeps();
    try {
      const bridge = createJsonlTailBridge({
        tmux,
        sessionStore,
        tailRoot: join(root, "projects"),
        paneProcess,
        cwdResolver: () => root,
      });
      expect(typeof bridge.broadcastFrameToChat).toBe("function");
      expect(typeof bridge.broadcastFrameToAll).toBe("function");
      // Calling broadcastFrameToChat with an unknown chatId is a no-op.
      bridge.broadcastFrameToChat("unknown", {
        kind: "chat-meta-changed",
        "chat-id": "unknown",
        body: { branch: null, worktreePath: null },
      });
      bridge.broadcastFrameToAll({
        kind: "ref-change",
        body: { cwd: root, branch: "main" },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
