import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { initMetadataStore } from "../src/metadata-store/index.ts";
import { createJsonlTailBridge } from "../src/process-manager/jsonl/bridge.ts";
import {
  createChatDiffPanelSubstrate,
  mountAllRoutes,
} from "../src/index.ts";
import type { ResolvedConfig } from "../src/config-loader/index.ts";
import { runFirstSendHook } from "../src/process-manager/first-send-hook.ts";
import { persistVcsKindOnAttach } from "../src/process-manager/persist-vcs-kind.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";
import { __resetVcsKindCacheForTests } from "../src/git/vcs-kind.ts";
import type { TmuxSessionApi } from "../src/process-manager/tmux-session.ts";
import type { SessionIdStore } from "../src/process-manager/session-store.ts";
import type {
  JsonlPathProbe,
  ResolvedTailRoot,
} from "../src/process-manager/jsonl-path-probe.ts";
import type { PaneProcessApi } from "../src/process-manager/pane-process.ts";

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  __resetVcsKindCacheForTests();
});

function createTmpRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-smoke-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "smoke@x"]);
  git(root, ["config", "user.name", "smoke"]);
  fs.writeFileSync(path.join(root, "README.md"), "smoke baseline\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

function fakeBridgeDeps() {
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
  const fakeTailRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-smoke-tail-"));
  const pathProbe: JsonlPathProbe = {
    async resolve(): Promise<ResolvedTailRoot> {
      return { tailRoot: fakeTailRoot, source: "default" };
    },
    async persist() {},
  };
  const paneProcess: PaneProcessApi = {
    async paneOwnsFile() {
      return true;
    },
    async pidsInPane() {
      return [];
    },
  };
  return { tmux, sessionStore, pathProbe, paneProcess, tailRoot: fakeTailRoot };
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;
function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("chat-diff-panel smoke gate", () => {
  test("end-to-end happy path via production-entrypoint wiring", async () => {
    // ── 1. Bootstrap — same path as production index.ts ─────────────
    const cwd = track(createTmpRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const config: ResolvedConfig = {
      root: cwd,
      source: "cli",
      worktreesRoot: null,
      configPath: "/tmp/smoke-config.json",
      defaultEnvMode: "local",
    };

    const { tmux, sessionStore, pathProbe, paneProcess, tailRoot } = fakeBridgeDeps();
    track(tailRoot);
    const frames: ServerFrame[] = [];
    const bridge = createJsonlTailBridge({
      tmux,
      sessionStore,
      pathProbe,
      paneProcess,
      cwdResolver: () => cwd,
    });
    // Intercept the bridge's outbound broadcast so test assertions see
    // every frame. The production server fans frames to attached WS
    // clients via the same `broadcastFrameTo*` API.
    const originalToAll = bridge.broadcastFrameToAll.bind(bridge);
    const originalToChat = bridge.broadcastFrameToChat.bind(bridge);
    bridge.broadcastFrameToAll = (frame) => {
      frames.push(frame);
      originalToAll(frame);
    };
    bridge.broadcastFrameToChat = (chatId, frame) => {
      frames.push(frame);
      originalToChat(chatId, frame);
    };

    const substrate = createChatDiffPanelSubstrate(bridge, config);
    const routes: Record<string, Handler> = {};
    mountAllRoutes(routes, {
      store,
      config,
      bridge,
      substrate,
      receiverPort: 3737,
      sessionStore,
    });

    // ── 2. Create chat ──────────────────────────────────────────────
    const chatId = "smoke-c1";
    store.chats.create({ id: chatId, cwd });
    // Brand-new chats start with worktree_mode === null; no workaround
    // mutation is needed — the hook will commit defaultEnvMode on send.
    expect(store.chats.get(chatId)!.worktree_mode).toBeNull();
    // Attach hook: persist vcs_kind.
    const attach = persistVcsKindOnAttach(store, chatId);
    expect(attach.vcsKind).toBe("git");
    expect(store.chats.get(chatId)!.vcs_kind).toBe("git");

    // ── 3. First send ───────────────────────────────────────────────
    const firstSend = await runFirstSendHook({
      store,
      chatId,
      defaultEnvMode: config.defaultEnvMode,
      checkpointStore: substrate.checkpointStore,
    });
    expect(firstSend.worktreeMode).toBe("local");
    expect(firstSend.checkpointRef).toBe(`refs/loom-checkpoints/${chatId}/0`);
    expect(git(cwd, ["show-ref", "--verify", `refs/loom-checkpoints/${chatId}/0`]).status).toBe(0);

    // ── 4. Mock one assistant turn → reactor → ref 1 ────────────────
    // Use the substrate's reactor + turn-watcher directly (production
    // wires them through the bridge's onAssistantTurnComplete; the
    // smoke avoids the tmux/jsonl tail path by driving captureTurn
    // synchronously).
    substrate.turnWatcher.start(chatId, cwd);
    fs.writeFileSync(path.join(cwd, "feature.txt"), "the agent's output\n");
    await substrate.reactor.captureTurn(chatId, 1, cwd);
    expect(git(cwd, ["show-ref", "--verify", `refs/loom-checkpoints/${chatId}/1`]).status).toBe(0);
    expect(frames.some((f) => f.kind === "checkpoint-captured")).toBe(true);

    // ── 5. GET /diff?mode=checkpoint-range&from=0&to=1 ──────────────
    const diffRes = await call(
      routes["/diff"]!,
      `http://x/diff?chatId=${chatId}&mode=checkpoint-range&from=0&to=1`,
    );
    expect(diffRes.status).toBe(200);
    const diffBody = (await diffRes.json()) as any;
    expect(diffBody.sections.length).toBeGreaterThan(0);
    expect(diffBody.sections[0].diff).toMatch(/feature\.txt/);

    // ── 6. POST /git/switchRef on a new branch ──────────────────────
    git(cwd, ["branch", "feat-smoke"]);
    const beforeFrameCount = frames.length;
    const switchRes = await call(routes["/git/switchRef"]!, "http://x/git/switchRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, refName: "feat-smoke" }),
    });
    expect(switchRes.status).toBe(200);
    expect(store.chats.get(chatId)!.branch).toBe("feat-smoke");
    expect(frames.slice(beforeFrameCount).some((f) => f.kind === "chat-meta-changed")).toBe(true);

    // ── 7. POST /git/createWorktree → worktree on disk + mode flip ─
    git(cwd, ["checkout", "main"]);
    const wtRes = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId, branch: "loom/smoke-c1" }),
    });
    expect(wtRes.status).toBe(200);
    const wtBody = (await wtRes.json()) as any;
    expect(fs.existsSync(wtBody.worktreePath)).toBe(true);
    expect(store.chats.get(chatId)!.worktree_mode).toBe("worktree");
    expect(store.chats.get(chatId)!.worktree_path).toBe(wtBody.worktreePath);

    // ── 8. GET /worktrees → both worktrees listed ───────────────────
    const listRes = await call(routes["/worktrees"]!, "http://x/worktrees");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as any;
    expect(listBody.worktrees.length).toBeGreaterThanOrEqual(2);

    // ── 9. POST /worktrees/delete on the new worktree (force) ──────
    const delRes = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtBody.worktreePath, confirm: true }),
    });
    expect(delRes.status).toBe(200);
    expect(store.chats.get(chatId)!.worktree_path).toBeNull();
    expect(store.chats.get(chatId)!.worktree_mode).toBe("local");

    // ── Teardown ────────────────────────────────────────────────────
    substrate.headWatcherSubscription?.unsubscribe();
    substrate.headWatcher.dispose();
    await store.close();
  });
});
