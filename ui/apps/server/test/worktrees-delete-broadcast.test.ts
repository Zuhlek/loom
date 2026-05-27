// Follow-up 2 — POST /worktrees/delete emits chat-meta-changed for
// every chat detached by the deletion. Chat-level removeWorktree
// already does this; the project-level handler must reuse the shared
// helper so each WS subscriber refreshes its row without a manual
// reload.
import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountWorktreesRoute } from "../src/routes/worktrees.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-wtdel-bcast-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

async function setup(serverCwd: string) {
  const store = await initMetadataStore({ inMemoryOnly: true });
  const frames: ServerFrame[] = [];
  const routes: Record<string, Handler> = {};
  mountWorktreesRoute(routes, store, serverCwd, (f) => frames.push(f));
  return { store, routes, frames };
}

function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("POST /worktrees/delete — broadcasts chat-meta-changed per detached tenant (Follow-up 2)", () => {
  test("two co-tenant chats → two chat-meta-changed frames carrying the updated rows", async () => {
    const cwd = track(makeGitRepo());
    const wtPath = path.join(cwd, ".loom-worktrees", "c1", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/c1", wtPath]);

    const { store, routes, frames } = await setup(cwd);
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { worktree_path: wtPath, worktree_mode: "worktree", branch: "loom/c1" });
    store.chats.create({ id: "c2", cwd });
    store.chats.update("c2", { worktree_path: wtPath, worktree_mode: "worktree", branch: "loom/c1" });

    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath, confirm: true }),
    });
    expect(res.status).toBe(200);

    // (a) Both rows are detached.
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    expect(store.chats.get("c1")!.branch).not.toBe("loom/c1");
    expect(store.chats.get("c2")!.worktree_path).toBeNull();
    expect(store.chats.get("c2")!.branch).not.toBe("loom/c1");

    // (b) Two chat-meta-changed frames, one per affected chat.
    const metaFrames = frames.filter((f) => f.kind === "chat-meta-changed") as Array<
      ServerFrame & { "chat-id": string; body: { branch: string | null; worktreePath: string | null } }
    >;
    expect(metaFrames.length).toBe(2);
    const chatIds = metaFrames.map((f) => f["chat-id"]).sort();
    expect(chatIds).toEqual(["c1", "c2"]);

    // (c) Each frame carries the updated row payload.
    for (const f of metaFrames) {
      expect(f.body.worktreePath).toBeNull();
      expect(typeof f.body.branch).toBe("string");
    }

    await store.close();
  });

  test("zero-tenant case → no broadcast, status 200", async () => {
    const cwd = track(makeGitRepo());
    const wtPath = path.join(cwd, ".loom-worktrees", "orphan", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/orphan", wtPath]);

    const { store, routes, frames } = await setup(cwd);
    // No chat rows reference this worktree.

    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath }),
    });
    expect(res.status).toBe(200);
    const metaFrames = frames.filter((f) => f.kind === "chat-meta-changed");
    expect(metaFrames.length).toBe(0);

    await store.close();
  });
});
