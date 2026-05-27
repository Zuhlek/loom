import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountGitVerbsRoute } from "../src/routes/git-verbs.ts";
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
  vi.restoreAllMocks();
});

function makeGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-verbs-"));
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
  mountGitVerbsRoute(routes, store, (f) => frames.push(f));
  return { store, frames, routes };
}
function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("POST /git/switchRef (T-011)", () => {
  test("classify=switch with default branch in local mode → checkout in cwd", async () => {
    const cwd = track(makeGitRepo());
    git(cwd, ["branch", "feat"]);
    const { store, frames, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(routes["/git/switchRef"]!, "http://x/git/switchRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", refName: "feat" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result).toBe("switch");
    expect(body.row.branch).toBe("feat");
    // git is actually on feat now
    expect(git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe("feat");
    // chat-meta-changed frame emitted
    expect(frames.some((f) => f.kind === "chat-meta-changed")).toBe(true);
    await store.close();
  });

  test("vcs_kind === 'unknown' chat → 400", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-verbs-bare-")));
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "unknown" });
    const res = await call(routes["/git/switchRef"]!, "http://x/git/switchRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", refName: "feat" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/not a git repo/i);
    await store.close();
  });

  test("missing chatId → 400", async () => {
    const { routes, store } = await setup();
    const res = await call(routes["/git/switchRef"]!, "http://x/git/switchRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refName: "x" }),
    });
    expect(res.status).toBe(400);
    await store.close();
  });
});

describe("POST /git/createRef (T-011)", () => {
  test("creates new branch + patches row + emits frame", async () => {
    const cwd = track(makeGitRepo());
    const { store, frames, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(routes["/git/createRef"]!, "http://x/git/createRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", newBranch: "feature-new" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.branch).toBe("feature-new");
    expect(git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe("feature-new");
    expect(frames.some((f) => f.kind === "chat-meta-changed")).toBe(true);
    await store.close();
  });

  test("vcs_kind === 'unknown' chat → 400", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-verbs-bare2-")));
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "unknown" });
    const res = await call(routes["/git/createRef"]!, "http://x/git/createRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", newBranch: "x" }),
    });
    expect(res.status).toBe(400);
    await store.close();
  });

  test("missing newBranch → 400", async () => {
    const cwd = track(makeGitRepo());
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(routes["/git/createRef"]!, "http://x/git/createRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1" }),
    });
    expect(res.status).toBe(400);
    await store.close();
  });

  test("createRef with already-existing branch surfaces git error as 500", async () => {
    const cwd = track(makeGitRepo());
    git(cwd, ["branch", "exists"]);
    const { store, routes } = await setup();
    store.chats.create({ id: "c1", cwd });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(routes["/git/createRef"]!, "http://x/git/createRef", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: "c1", newBranch: "exists" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    await store.close();
  });
});
