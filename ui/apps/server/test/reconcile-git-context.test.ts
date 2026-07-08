import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { reconcileGitContextOnAttach } from "../src/process-manager/reconcile-git-context.ts";
import { __resetVcsKindCacheForTests } from "../src/git/vcs-kind.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
function makeGitDir(branch?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-attach-vcs-"));
  fs.mkdirSync(path.join(root, ".git"));
  if (branch) fs.writeFileSync(path.join(root, ".git/HEAD"), `ref: refs/heads/${branch}\n`);
  return root;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  __resetVcsKindCacheForTests();
});

describe("reconcileGitContextOnAttach", () => {
  test("first attach on a git cwd persists vcs_kind + repo_name", async () => {
    const cwd = track(makeGitDir());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd });
    expect(chat.vcs_kind).toBeNull();
    const r = reconcileGitContextOnAttach(store, "c1");
    expect(r.vcsChanged).toBe(true);
    expect(r.vcsKind).toBe("git");
    expect(store.chats.get("c1")!.vcs_kind).toBe("git");
    expect(store.chats.get("c1")!.repo_name).toBe(path.basename(cwd));
    await store.close();
  });

  test("first attach on a non-git cwd persists 'unknown'", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-attach-bare-")));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c2", cwd });
    const r = reconcileGitContextOnAttach(store, "c2");
    expect(r.vcsChanged).toBe(true);
    expect(r.vcsKind).toBe("unknown");
    expect(store.chats.get("c2")!.vcs_kind).toBe("unknown");
    await store.close();
  });

  test("re-attach with nothing stale is a no-op", async () => {
    const cwd = track(makeGitDir());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c3", cwd });
    reconcileGitContextOnAttach(store, "c3");
    const r2 = reconcileGitContextOnAttach(store, "c3");
    expect(r2.vcsChanged).toBe(false);
    expect(r2.branchChanged).toBe(false);
    expect(r2.vcsKind).toBe("git");
    await store.close();
  });

  test("self-heals a stale 'unknown' row back to 'git'", async () => {
    // Simulates a row frozen as "unknown" during a past mount fault.
    const cwd = track(makeGitDir());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c4", cwd });
    store.chats.update("c4", { vcs_kind: "unknown" });
    const r = reconcileGitContextOnAttach(store, "c4");
    expect(r.vcsChanged).toBe(true);
    expect(r.vcsKind).toBe("git");
    expect(store.chats.get("c4")!.vcs_kind).toBe("git");
    await store.close();
  });

  test("resolves a null branch to the project HEAD for a local-mode chat", async () => {
    const cwd = track(makeGitDir("feature-x"));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c5", cwd });
    store.chats.update("c5", { vcs_kind: "git", worktree_mode: "local", branch: null });
    const r = reconcileGitContextOnAttach(store, "c5");
    expect(r.branchChanged).toBe(true);
    expect(r.branch).toBe("feature-x");
    expect(store.chats.get("c5")!.branch).toBe("feature-x");
    await store.close();
  });

  test("leaves branch alone for a worktree-mode chat (it owns its branch)", async () => {
    const cwd = track(makeGitDir("feature-x"));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c6", cwd });
    store.chats.update("c6", { vcs_kind: "git", worktree_mode: "worktree", branch: "loom/c6" });
    const r = reconcileGitContextOnAttach(store, "c6");
    expect(r.branchChanged).toBe(false);
    expect(store.chats.get("c6")!.branch).toBe("loom/c6");
    await store.close();
  });

  test("unknown chat id → no-op", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const r = reconcileGitContextOnAttach(store, "does-not-exist");
    expect(r.vcsChanged).toBe(false);
    expect(r.vcsKind).toBeNull();
    await store.close();
  });
});
