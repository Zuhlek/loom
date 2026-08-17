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

// Mode + worktree_path are committed at spawn time (resolve-spawn-cwd);
// see worktree-optin-spawn.test.ts. The hook records the branch and
// writes checkpoint ref 0.
describe("first-send hook (T-015)", () => {
  test("local chat → records project HEAD branch, writes ref 0", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd, worktree_mode: "local" });
    const r = await runFirstSendHook({ store, chatId: "c1", checkpointStore: createCheckpointStore() });
    expect(r.worktreeMode).toBe("local");
    expect(r.branch).toBe("main");
    expect(store.chats.get("c1")!.branch).toBe("main");
    expect(r.checkpointRef).toBe("refs/loom-checkpoints/c1/0");
    expect(git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/0"]).status).toBe(0);
    await store.close();
  });

  test("worktree chat → checkpoint captured inside the worktree, branch left alone", async () => {
    const cwd = track(makeGitRepo());
    const wt = path.join(cwd, ".loom-worktrees", "c2");
    expect(git(cwd, ["worktree", "add", "-b", "loom/c2", wt]).status).toBe(0);
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c2", cwd, worktree_mode: "worktree" });
    store.chats.update("c2", { worktree_path: wt, branch: "loom/c2" });

    const r = await runFirstSendHook({ store, chatId: "c2", checkpointStore: createCheckpointStore() });
    expect(r.worktreePath).toBe(wt);
    expect(r.branch).toBe("loom/c2");
    expect(r.checkpointRef).toBe("refs/loom-checkpoints/c2/0");
    expect(git(wt, ["show-ref", "--verify", "refs/loom-checkpoints/c2/0"]).status).toBe(0);
    await store.close();
  });

  test("second invocation does not re-write the branch", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c3", cwd, worktree_mode: "local" });
    const ckStore = createCheckpointStore();
    await runFirstSendHook({ store, chatId: "c3", checkpointStore: ckStore });
    const before = JSON.stringify(store.chats.get("c3"));
    await runFirstSendHook({ store, chatId: "c3", checkpointStore: ckStore });
    expect(JSON.stringify(store.chats.get("c3"))).toBe(before);
    await store.close();
  });

  test("non-git cwd → no branch, no ref written", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-fs-bare-")));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c5", cwd, worktree_mode: "local" });
    const r = await runFirstSendHook({ store, chatId: "c5", checkpointStore: createCheckpointStore() });
    expect(r.branch).toBeNull();
    expect(r.checkpointRef).toBeNull();
    await store.close();
  });

  test("missing chat throws", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    await expect(
      runFirstSendHook({ store, chatId: "nope", checkpointStore: createCheckpointStore() }),
    ).rejects.toThrow(/chat not found/);
    await store.close();
  });
});
