import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { runFirstSendHook } from "../src/process-manager/first-send-hook.ts";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";

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
  vi.restoreAllMocks();
});

function makeGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-fs-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

describe("first-send hook (T-015)", () => {
  test("defaultEnvMode=local + null worktree_mode → commits local, writes ref 0", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd });
    // Brand-new chats start with worktree_mode === null — the hook
    // commits it on first send. No workaround mutation needed.
    expect(store.chats.get("c1")!.worktree_mode).toBeNull();
    const ckStore = createCheckpointStore();
    const r = await runFirstSendHook({
      store,
      chatId: "c1",
      defaultEnvMode: "local",
      checkpointStore: ckStore,
    });
    expect(r.worktreeMode).toBe("local");
    expect(r.checkpointRef).toBe("refs/loom-checkpoints/c1/0");
    expect(store.chats.get("c1")!.worktree_mode).toBe("local");
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    const showRef = git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/0"]);
    expect(showRef.status).toBe(0);
    await store.close();
  });

  test("defaultEnvMode=worktree → creates worktree, commits worktree, ref 0 written", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c2", cwd });
    expect(store.chats.get("c2")!.worktree_mode).toBeNull();
    const ckStore = createCheckpointStore();
    const r = await runFirstSendHook({
      store,
      chatId: "c2",
      defaultEnvMode: "worktree",
      checkpointStore: ckStore,
    });
    expect(r.worktreeMode).toBe("worktree");
    expect(r.worktreePath).toBeTruthy();
    expect(fs.existsSync(r.worktreePath!)).toBe(true);
    expect(store.chats.get("c2")!.branch).toBe("loom/c2");
    const showRef = git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c2/0"]);
    expect(showRef.status).toBe(0);
    await store.close();
  });

  test("second invocation is idempotent (no second update or capture)", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c3", cwd });
    expect(store.chats.get("c3")!.worktree_mode).toBeNull();
    const ckStore = createCheckpointStore();
    await runFirstSendHook({ store, chatId: "c3", defaultEnvMode: "local", checkpointStore: ckStore });
    const before = JSON.stringify(store.chats.get("c3"));
    const r2 = await runFirstSendHook({
      store,
      chatId: "c3",
      defaultEnvMode: "worktree",
      checkpointStore: ckStore,
    });
    expect(r2.alreadyCommitted).toBe(true);
    // No mode flip
    expect(store.chats.get("c3")!.worktree_mode).toBe("local");
    expect(JSON.stringify(store.chats.get("c3"))).toBe(before);
    await store.close();
  });

  test("worktree creation throws → fallback to local + notice", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c4", cwd });
    expect(store.chats.get("c4")!.worktree_mode).toBeNull();
    const ckStore = createCheckpointStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await runFirstSendHook({
      store,
      chatId: "c4",
      defaultEnvMode: "worktree",
      checkpointStore: ckStore,
      createWorktreeImpl: async () => {
        throw new Error("simulated");
      },
    });
    expect(r.worktreeMode).toBe("local");
    expect(r.worktreePath).toBeNull();
    expect(warn).toHaveBeenCalled();
    await store.close();
  });

  test("non-git cwd → worktree_mode=local, no ref written", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-fs-bare-")));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c5", cwd });
    expect(store.chats.get("c5")!.worktree_mode).toBeNull();
    const ckStore = createCheckpointStore();
    const r = await runFirstSendHook({
      store,
      chatId: "c5",
      defaultEnvMode: "local",
      checkpointStore: ckStore,
    });
    expect(r.worktreeMode).toBe("local");
    expect(r.checkpointRef).toBeNull();
    await store.close();
  });
});
