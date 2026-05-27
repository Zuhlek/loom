import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";

function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function makeGitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-checkpoint-store-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
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

describe("CheckpointStore (T-006)", () => {
  test("captureTurn writes refs/loom-checkpoints/<chatId>/<n>", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const r = await store.captureTurn({ chatId: "c1", cwd, turn: 0 });
    expect(r).not.toBeNull();
    expect(r!.ref).toBe("refs/loom-checkpoints/c1/0");
    const exists = git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/0"]);
    expect(exists.status).toBe(0);
  });

  test("turn 1 commit has parent = turn 0 commit", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const r0 = await store.captureTurn({ chatId: "c2", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
    const r1 = await store.captureTurn({ chatId: "c2", cwd, turn: 1 });
    expect(r1).not.toBeNull();
    const parents = git(cwd, ["log", "--pretty=%P", "-1", r1!.sha]);
    expect(parents.status).toBe(0);
    expect(parents.stdout.trim()).toBe(r0!.sha);
  });

  test("non-git cwd → returns null without throwing", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-not-git-")));
    const store = createCheckpointStore();
    const r = await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    expect(r).toBeNull();
  });

  test("idempotent on (chatId, turn) — re-capture returns the same sha", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const a = await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    const b = await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    expect(a!.sha).toBe(b!.sha);
  });

  test("resolveRef(start) → ref 0, resolveRef(latest) → highest turn ref", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 1 });
    fs.writeFileSync(path.join(cwd, "c.txt"), "c\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 2 });
    const start = await store.resolveRef("c", "start", cwd);
    const latest = await store.resolveRef("c", "latest", cwd);
    const turn1 = await store.resolveRef("c", 1, cwd);
    expect(start).toBe("refs/loom-checkpoints/c/0");
    expect(latest).toBe("refs/loom-checkpoints/c/2");
    expect(turn1).toBe("refs/loom-checkpoints/c/1");
  });

  test("listTurns returns ascending turn numbers", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 2 });
    fs.writeFileSync(path.join(cwd, "c.txt"), "c\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 1 });
    const turns = await store.listTurns("c", cwd);
    expect(turns).toEqual([0, 1, 2]);
  });

  test("resolveRef returns null when the ref is missing", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const r = await store.resolveRef("does-not-exist", 0, cwd);
    expect(r).toBeNull();
  });

  test("capture in a tmpdir with 100 files completes in under 500ms (soft)", async () => {
    const cwd = track(makeGitRepo());
    for (let i = 0; i < 100; i++) {
      fs.writeFileSync(path.join(cwd, `f-${i}.txt`), `${i}\n`);
    }
    const store = createCheckpointStore();
    const t0 = Date.now();
    const r = await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    const elapsed = Date.now() - t0;
    expect(r).not.toBeNull();
    if (elapsed > 500) {
      // soft assertion; log only
      // eslint-disable-next-line no-console
      console.warn(`[T-006 perf] capture took ${elapsed}ms (budget 500ms)`);
    }
  });
});
