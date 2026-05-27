import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsMetaRoute } from "../src/routes/chats-meta.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

async function setup() {
  const store = await initMetadataStore({ inMemoryOnly: true });
  const frames: ServerFrame[] = [];
  const routes: Record<string, Handler> = {};
  const broadcast = (frame: ServerFrame) => frames.push(frame);
  mountChatsMetaRoute(routes, store, broadcast);
  return { store, frames, routes };
}

function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("PATCH /chats/meta (T-010)", () => {
  test("partial body patch (branch only) merges row and emits frame", async () => {
    const { store, frames, routes } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-meta-")));
    const chat = store.chats.create({ id: "c1", cwd: tmp });
    expect(chat.branch).toBeNull();
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c1", branch: "feat" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.row.branch).toBe("feat");
    expect(body.row.worktree_path).toBeNull();
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe("chat-meta-changed");
    expect((frames[0] as any).body.branch).toBe("feat");
    expect((frames[0] as any).body.worktreePath).toBeNull();
  });

  test("worktree_path patch with existing path merges row and emits frame", async () => {
    const { store, frames, routes } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-meta-wt-")));
    const wt = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-meta-wtpath-")));
    store.chats.create({ id: "c1", cwd: tmp });
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c1", worktree_path: wt }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.row.worktree_path).toBe(wt);
    expect(frames).toHaveLength(1);
    expect((frames[0] as any).body.worktreePath).toBe(wt);
  });

  test("non-existent worktree_path → 400 + 'worktree path does not exist'", async () => {
    const { store, frames, routes } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-meta-bad-")));
    store.chats.create({ id: "c1", cwd: tmp });
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c1", worktree_path: "/does/not/exist-xyz" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/worktree path does not exist/i);
    expect(frames).toHaveLength(0);
  });

  test("unknown chat id → 404", async () => {
    const { routes } = await setup();
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "nope", branch: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("missing id → 400", async () => {
    const { routes } = await setup();
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("non-PATCH method → 405", async () => {
    const { routes } = await setup();
    const res = await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "GET",
    });
    expect(res.status).toBe(405);
  });

  test("legacy row patch preserves worktree_mode", async () => {
    const { store, routes } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-meta-legacy-")));
    store.chats.create({ id: "c1", cwd: tmp, worktree_mode: "worktree" });
    await call(routes["/chats/meta"]!, "http://x/chats/meta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c1", branch: "feat" }),
    });
    expect(store.chats.get("c1")!.worktree_mode).toBe("worktree");
  });
});
