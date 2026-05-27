import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountGitWorktreeRoute } from "../src/routes/git-worktree.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";
import { __resetVcsKindCacheForTests } from "../src/git/vcs-kind.ts";

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

function makeGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-gitwt-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;
async function setup() {
  const store = await initMetadataStore({ inMemoryOnly: true });
  const frames: ServerFrame[] = [];
  const routes: Record<string, Handler> = {};
  mountGitWorktreeRoute(routes, store, (f) => frames.push(f));
  return { store, frames, routes };
}
function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("POST /git/createWorktree (T-012)", () => {
  test("happy path on a local-mode chat → creates worktree + flips mode", async () => {
    const cwd = track(makeGitRepo());
    const { store, frames, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", branch: "loom/c1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.worktreePath).toBe("string");
    expect(fs.existsSync(body.worktreePath)).toBe(true);
    expect(body.row.worktree_mode).toBe("worktree");
    expect(body.row.worktree_path).toBe(body.worktreePath);
    expect(body.row.branch).toBe("loom/c1");
    expect(frames.some((f) => f.kind === "chat-meta-changed")).toBe(true);
    await store.close();
  });

  test("default branch name is loom/<chatId>", async () => {
    const cwd = track(makeGitRepo());
    const { store, routes } = await setup();
    store.chats.create({ id: "abc", cwd });
    store.chats.update("abc", { vcs_kind: "git" });
    const res = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "abc" }),
    });
    const body = (await res.json()) as any;
    expect(body.row.branch).toBe("loom/abc");
    await store.close();
  });

  test("vcs_kind === 'unknown' → 400", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-gitwt-bare-")));
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "unknown" });
    const res = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1" }),
    });
    expect(res.status).toBe(400);
    await store.close();
  });
});

describe("POST /git/removeWorktree (T-012)", () => {
  test("solo-tenant removeWorktree clears the row's worktree_path", async () => {
    const cwd = track(makeGitRepo());
    const { store, frames, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const created = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1" }),
    });
    const cbody = (await created.json()) as any;
    const wtPath = cbody.worktreePath;
    frames.length = 0;
    const res = await call(routes["/git/removeWorktree"]!, "http://x/git/removeWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.removed).toBe(true);
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    expect(store.chats.get("c1")!.worktree_mode).toBe("local");
    expect(frames.some((f) => f.kind === "chat-meta-changed")).toBe(true);
    await store.close();
  });

  test("co-tenants without force → 409 + co_tenants", async () => {
    const cwd = track(makeGitRepo());
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const created = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1" }),
    });
    const wtPath = ((await created.json()) as any).worktreePath;
    // Second chat now points to the same worktree.
    store.chats.create({ id: "c2", cwd });
    store.chats.update("c2", { vcs_kind: "git", worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/git/removeWorktree"]!, "http://x/git/removeWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.co_tenants).toContain("c1");
    expect(body.co_tenants).toContain("c2");
    expect(fs.existsSync(wtPath)).toBe(true);
    await store.close();
  });

  test("co-tenants with force=true → removes + patches every tenant", async () => {
    const cwd = track(makeGitRepo());
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const created = await call(routes["/git/createWorktree"]!, "http://x/git/createWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1" }),
    });
    const wtPath = ((await created.json()) as any).worktreePath;
    store.chats.create({ id: "c2", cwd });
    store.chats.update("c2", { vcs_kind: "git", worktree_path: wtPath, worktree_mode: "worktree" });

    const res = await call(routes["/git/removeWorktree"]!, "http://x/git/removeWorktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: wtPath, force: true }),
    });
    expect(res.status).toBe(200);
    expect(store.chats.get("c1")!.worktree_path).toBeNull();
    expect(store.chats.get("c2")!.worktree_path).toBeNull();
    expect(store.chats.get("c1")!.worktree_mode).toBe("local");
    expect(store.chats.get("c2")!.worktree_mode).toBe("local");
    await store.close();
  });
});
