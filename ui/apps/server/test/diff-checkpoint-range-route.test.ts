import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";
import { createCheckpointDiffQuery } from "../src/checkpointing/checkpoint-diff-query.ts";
import { mountDiffRoute } from "../src/routes/diff.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diff-route-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

type Handler = (req: Request, url: URL) => Response | Promise<Response>;
function call(handler: Handler, url: string) {
  return handler(new Request(url), new URL(url));
}

describe("GET /diff?mode=checkpoint-range (T-007)", () => {
  test("from=0&to=1 returns non-empty sections after two captures", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd });
    const ckStore = createCheckpointStore();
    const diffQuery = createCheckpointDiffQuery(ckStore);
    await ckStore.captureTurn({ chatId: "c1", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "f.txt"), "feature\n");
    await ckStore.captureTurn({ chatId: "c1", cwd, turn: 1 });

    const routes: Record<string, Handler> = {};
    mountDiffRoute(routes, { store, diffQuery });
    const res = await call(
      routes["/diff"]!,
      `http://x/diff?chatId=c1&mode=checkpoint-range&from=0&to=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.sections[0].diff).toMatch(/f\.txt/);
    await store.close();
  });

  test("from=0&to=latest equates to whole-chat diff", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd });
    const ckStore = createCheckpointStore();
    const diffQuery = createCheckpointDiffQuery(ckStore);
    await ckStore.captureTurn({ chatId: "c1", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
    await ckStore.captureTurn({ chatId: "c1", cwd, turn: 1 });
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    await ckStore.captureTurn({ chatId: "c1", cwd, turn: 2 });

    const routes: Record<string, Handler> = {};
    mountDiffRoute(routes, { store, diffQuery });
    const res = await call(
      routes["/diff"]!,
      `http://x/diff?chatId=c1&mode=checkpoint-range&from=0&to=latest`,
    );
    const body = (await res.json()) as any;
    expect(body.sections[0].diff).toMatch(/a\.txt/);
    expect(body.sections[0].diff).toMatch(/b\.txt/);
    await store.close();
  });

  test("missing refs → 200 + empty sections", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    store.chats.create({ id: "c1", cwd });
    const ckStore = createCheckpointStore();
    const diffQuery = createCheckpointDiffQuery(ckStore);

    const routes: Record<string, Handler> = {};
    mountDiffRoute(routes, { store, diffQuery });
    const res = await call(
      routes["/diff"]!,
      `http://x/diff?chatId=c1&mode=checkpoint-range&from=99&to=100`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sections).toEqual([]);
    await store.close();
  });

  test("old shape ?worktreePath=...&base=...&mode=whole still works (back-compat)", async () => {
    const cwd = track(makeGitRepo());
    const store = await initMetadataStore({ inMemoryOnly: true });
    const ckStore = createCheckpointStore();
    const diffQuery = createCheckpointDiffQuery(ckStore);

    const routes: Record<string, Handler> = {};
    mountDiffRoute(routes, { store, diffQuery });
    const res = await call(
      routes["/diff"]!,
      `http://x/diff?worktreePath=${encodeURIComponent(cwd)}&base=main&mode=whole`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.sections)).toBe(true);
    await store.close();
  });

  test("checkpoint-range without chatId → 400", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const ckStore = createCheckpointStore();
    const diffQuery = createCheckpointDiffQuery(ckStore);
    const routes: Record<string, Handler> = {};
    mountDiffRoute(routes, { store, diffQuery });
    const res = await call(
      routes["/diff"]!,
      `http://x/diff?mode=checkpoint-range&from=0&to=1`,
    );
    expect(res.status).toBe(400);
    await store.close();
  });
});
