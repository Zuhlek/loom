import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { persistVcsKindOnAttach } from "../src/process-manager/persist-vcs-kind.ts";
import { __resetVcsKindCacheForTests } from "../src/git/vcs-kind.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
function makeGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-attach-vcs-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  __resetVcsKindCacheForTests();
});

describe("persistVcsKindOnAttach (T-008 attach hook)", () => {
  test("first attach with vcs_kind=null persists 'git' on the row", async () => {
    const cwd = track(makeGitDir());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd });
    expect(chat.vcs_kind).toBeNull();
    const r = persistVcsKindOnAttach(store, "c1");
    expect(r.written).toBe(true);
    expect(r.vcsKind).toBe("git");
    expect(store.chats.get("c1")!.vcs_kind).toBe("git");
    // repo_name is the git top-level basename (here the tmp dir itself).
    expect(store.chats.get("c1")!.repo_name).toBe(path.basename(cwd));
    await store.close();
  });

  test("first attach on a non-git cwd persists 'unknown'", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-attach-bare-")));
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c2", cwd });
    const r = persistVcsKindOnAttach(store, "c2");
    expect(r.written).toBe(true);
    expect(r.vcsKind).toBe("unknown");
    expect(store.chats.get("c2")!.vcs_kind).toBe("unknown");
    await store.close();
  });

  test("second attach on the same chat does not re-write", async () => {
    const cwd = track(makeGitDir());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c3", cwd });
    persistVcsKindOnAttach(store, "c3");
    const r2 = persistVcsKindOnAttach(store, "c3");
    expect(r2.written).toBe(false);
    expect(r2.vcsKind).toBe("git");
    await store.close();
  });

  test("unknown chat id → no-op", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const r = persistVcsKindOnAttach(store, "does-not-exist");
    expect(r.written).toBe(false);
    expect(r.vcsKind).toBeNull();
    await store.close();
  });
});
