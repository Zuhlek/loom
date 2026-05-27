import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountWorktreesRoute } from "../src/routes/worktrees.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-wtroute-"));
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
  const routes: Record<string, Handler> = {};
  mountWorktreesRoute(routes, store, serverCwd);
  return { store, routes };
}
function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("GET /worktrees (T-013)", () => {
  test("lists worktrees with tenantChatIds populated from chats repo", async () => {
    const cwd = track(makeGitRepo());
    // Add a second worktree under .loom-worktrees so listWorktrees finds it.
    const wtPath = path.join(cwd, ".loom-worktrees", "c1", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/c1", wtPath]);
    const { store, routes } = await setup(cwd);
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/worktrees"]!, "http://x/worktrees");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.worktrees.length).toBeGreaterThanOrEqual(1);
    const ours = body.worktrees.find((w: any) => w.path === wtPath || w.path === fs.realpathSync(wtPath));
    expect(ours).toBeDefined();
    expect(ours.tenantChatIds).toContain("c1");
    await store.close();
  });
});

describe("POST /worktrees/delete (T-013)", () => {
  test("co-tenants without confirm → 409 + co_tenants + require_confirm", async () => {
    const cwd = track(makeGitRepo());
    const wtPath = path.join(cwd, ".loom-worktrees", "c1", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/c1", wtPath]);
    const { store, routes } = await setup(cwd);
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { worktree_path: wtPath, worktree_mode: "worktree" });
    store.chats.create({ id: "c2", cwd });
    store.chats.update("c2", { worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.require_confirm).toBe(true);
    expect(body.co_tenants).toContain("c1");
    expect(body.co_tenants).toContain("c2");
    expect(fs.existsSync(wtPath)).toBe(true);
    await store.close();
  });

  test("co-tenants with confirm=true → removes worktree + clears every tenant's path", async () => {
    const cwd = track(makeGitRepo());
    const wtPath = path.join(cwd, ".loom-worktrees", "c1", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/c1", wtPath]);
    const { store, routes } = await setup(cwd);
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { worktree_path: wtPath, worktree_mode: "worktree" });
    store.chats.create({ id: "c2", cwd });
    store.chats.update("c2", { worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath, confirm: true }),
    });
    expect(res.status).toBe(200);
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    expect(store.chats.get("c2")!.worktree_path).toBeNull();
    await store.close();
  });

  test("solo tenant → removes without confirm", async () => {
    const cwd = track(makeGitRepo());
    const wtPath = path.join(cwd, ".loom-worktrees", "c1", "abc");
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    git(cwd, ["worktree", "add", "-b", "loom/c1", wtPath]);
    const { store, routes } = await setup(cwd);
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath }),
    });
    expect(res.status).toBe(200);
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    await store.close();
  });

  test("delete with missing worktreePath → 400", async () => {
    const cwd = track(makeGitRepo());
    const { store, routes } = await setup(cwd);
    const res = await call(routes["/worktrees/delete"]!, "http://x/worktrees/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    await store.close();
  });
});
