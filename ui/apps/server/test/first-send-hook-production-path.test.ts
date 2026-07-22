// B1 evidence — first-send hook flips worktree_mode in production paths.
//
// This test takes the exact code path production takes: POST /chats →
// row created with no explicit worktreeMode → runFirstSendHook reads
// the row + commits the configured defaultEnvMode. The Build-2 build
// failed this scenario silently because chatRepo.create() defaulted
// worktree_mode to "local" — the hook short-circuited on the very
// first invocation.
import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { initMetadataStore } from "../src/metadata-store/index.ts";
import { runFirstSendHook } from "../src/process-manager/first-send-hook.ts";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

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
});

function makeGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-b1-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

describe("B1 production-path: first-send hook commits worktree_mode", () => {
  test("POST /chats with no worktreeMode → row.worktree_mode is null → hook commits defaultEnvMode='worktree'", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });

    const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
    mountChatsRoute(routes, store);

    // Production-shaped chat creation. The web client posts cwd-only;
    // no worktreeMode is sent because the EnvMode default lives in
    // settings (Q06). The created row MUST have worktree_mode === null
    // so the first-send hook can commit it later.
    const createReq = new Request("http://x/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const createUrl = new URL(createReq.url);
    const createRes = await routes["/chats"]!(createReq, createUrl);
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { chat: { id: string; worktree_mode: any } };
    expect(created.chat.worktree_mode).toBeNull();

    const chatId = created.chat.id;
    // Sanity: the row stored matches the API response.
    expect(store.chats.get(chatId)!.worktree_mode).toBeNull();

    // First-send hook → commit defaultEnvMode = "worktree". This is
    // the path that failed silently in Build-2.
    const ckStore = createCheckpointStore();
    await runFirstSendHook({
      store,
      chatId,
      defaultEnvMode: "worktree",
      checkpointStore: ckStore,
    });
    // The row reflects the committed mode.
    const row = store.chats.get(chatId)!;
    expect(row.worktree_mode).toBe("worktree");
    expect(row.worktree_path).toBeTruthy();
    expect(fs.existsSync(row.worktree_path!)).toBe(true);

    // ref 0 was written (US-013 AC2 / US-005 AC1 baseline).
    const showRef = git(cwd, ["show-ref", "--verify", `refs/loom-checkpoints/${chatId}/0`]);
    expect(showRef.status).toBe(0);

    await store.close();
  });

  test("POST /chats with no worktreeMode → row.worktree_mode is null → hook commits defaultEnvMode='local'", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
    mountChatsRoute(routes, store);

    const createRes = await routes["/chats"]!(
      new Request("http://x/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      }),
      new URL("http://x/chats"),
    );
    const created = (await createRes.json()) as { chat: { id: string; worktree_mode: any } };
    expect(created.chat.worktree_mode).toBeNull();
    const chatId = created.chat.id;

    await runFirstSendHook({
      store,
      chatId,
      defaultEnvMode: "local",
      checkpointStore: createCheckpointStore(),
    });
    expect(store.chats.get(chatId)!.worktree_mode).toBe("local");
    expect(store.chats.get(chatId)!.worktree_path).toBeNull();
    await store.close();
  });

  test("POST /chats with explicit worktreeMode='worktree' → row committed at creation; hook short-circuits", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
    mountChatsRoute(routes, store);

    const createRes = await routes["/chats"]!(
      new Request("http://x/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, worktreeMode: "worktree" }),
      }),
      new URL("http://x/chats"),
    );
    const created = (await createRes.json()) as { chat: { id: string; worktree_mode: any } };
    // Caller-supplied mode is honoured at creation, so the hook will
    // see "worktree" and short-circuit.
    expect(created.chat.worktree_mode).toBe("worktree");

    await runFirstSendHook({
      store,
      chatId: created.chat.id,
      defaultEnvMode: "local",
      checkpointStore: createCheckpointStore(),
    });
    // Short-circuited: the caller-supplied worktree mode is untouched
    // and no local fallback occurred.
    expect(store.chats.get(created.chat.id)!.worktree_mode).toBe("worktree");
    await store.close();
  });
});
