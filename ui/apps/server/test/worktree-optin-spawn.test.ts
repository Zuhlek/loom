// Regression: the worktree opt-in never materialised. The row carried
// `worktree_mode: "worktree"` but nothing ever created a worktree —
// `resolveSpawnCwd` was dead code, the bridge spawned in `chat.cwd`, and
// the first-send hook short-circuited on any already-committed mode.
// These tests drive the production path: POST /chats → cwdResolver.
import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";
import { resolveAndPersistSpawnCwd } from "../src/process-manager/resolve-spawn-cwd.ts";

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
  const root = fs.realpathSync(track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-wt-"))));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

async function createChat(store: Awaited<ReturnType<typeof initMetadataStore>>, body: object) {
  const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
  mountChatsRoute(routes, store);
  const res = await routes["/chats"]!(
    new Request("http://x/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    new URL("http://x/chats"),
  );
  const json = (await res.json()) as { chat: { id: string; worktree_mode: string | null } };
  return json.chat;
}

describe("worktree opt-in materialises at spawn", () => {
  test("POST /chats worktreeMode='worktree' → spawn cwd IS a worktree, row persists path + branch", async () => {
    const cwd = makeGitRepo();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = await createChat(store, { cwd, worktreeMode: "worktree" });
    expect(chat.worktree_mode).toBe("worktree");
    expect(store.chats.get(chat.id)!.worktree_path).toBeNull();

    const spawnCwd = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "local" }, chat.id);

    expect(spawnCwd).not.toBe(cwd);
    expect(fs.existsSync(spawnCwd)).toBe(true);
    // It is a real worktree of the parent repo, checked out on loom/<id>.
    expect(git(spawnCwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe(`loom/${chat.id}`);
    const row = store.chats.get(chat.id)!;
    expect(row.worktree_mode).toBe("worktree");
    expect(row.worktree_path).toBe(spawnCwd);
    expect(row.branch).toBe(`loom/${chat.id}`);
    await store.close();
  });

  test("respawn reuses the same worktree", async () => {
    const cwd = makeGitRepo();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = await createChat(store, { cwd, worktreeMode: "worktree" });
    const first = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "local" }, chat.id);
    const second = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "local" }, chat.id);
    expect(second).toBe(first);
    await store.close();
  });

  test("null mode falls to config.defaultEnvMode in both directions", async () => {
    const cwd = makeGitRepo();
    const store = await initMetadataStore({ inMemoryOnly: true });

    const auto = await createChat(store, { cwd });
    expect(auto.worktree_mode).toBeNull();
    const autoCwd = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "worktree" }, auto.id);
    expect(autoCwd).not.toBe(cwd);
    expect(store.chats.get(auto.id)!.worktree_mode).toBe("worktree");

    const plain = await createChat(store, { cwd });
    const plainCwd = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "local" }, plain.id);
    expect(plainCwd).toBe(cwd);
    expect(store.chats.get(plain.id)!.worktree_mode).toBe("local");
    await store.close();
  });

  test("explicit local wins over defaultEnvMode='worktree'", async () => {
    const cwd = makeGitRepo();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = await createChat(store, { cwd, worktreeMode: "local" });
    const spawnCwd = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "worktree" }, chat.id);
    expect(spawnCwd).toBe(cwd);
    expect(store.chats.get(chat.id)!.worktree_path).toBeNull();
    await store.close();
  });

  test("non-git cwd → bare cwd, row committed as local (mode never lies)", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-bare-")));
    const store = await initMetadataStore({ inMemoryOnly: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chat = await createChat(store, { cwd, worktreeMode: "worktree" });
    const spawnCwd = await resolveAndPersistSpawnCwd(store, { defaultEnvMode: "local" }, chat.id);
    expect(spawnCwd).toBe(cwd);
    expect(store.chats.get(chat.id)!.worktree_mode).toBe("local");
    expect(warn).toHaveBeenCalled();
    await store.close();
  });

  test("worktree creation failure falls back to the bare cwd instead of throwing", async () => {
    const cwd = makeGitRepo();
    const store = await initMetadataStore({ inMemoryOnly: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chat = await createChat(store, { cwd, worktreeMode: "worktree" });
    const spawnCwd = await resolveAndPersistSpawnCwd(
      store,
      { defaultEnvMode: "local" },
      chat.id,
      {
        isGitRepo: () => ({ isGit: true, repoName: "repo", topLevel: cwd }),
        createWorktree: async () => {
          throw new Error("simulated git failure");
        },
      },
    );
    expect(spawnCwd).toBe(cwd);
    expect(store.chats.get(chat.id)!.worktree_mode).toBe("local");
    expect(warn).toHaveBeenCalled();
    await store.close();
  });

  test("index.ts routes cwdResolver through the resolver (the helper was dead code once)", () => {
    const src = fs.readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/cwdResolver:.*resolveAndPersistSpawnCwd/s);
  });
});
