import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";
import { createCheckpointDiffQuery } from "../src/checkpointing/checkpoint-diff-query.ts";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffq-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

describe("CheckpointDiffQuery (T-007)", () => {
  test("getTurnDiff({from:0, to:1}) returns non-empty diff for changed working tree", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const query = createCheckpointDiffQuery(store);
    await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "feat.txt"), "feature body\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 1 });
    const r = await query.getTurnDiff({ chatId: "c", cwd, from: 0, to: 1 });
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.sections[0]!.diff).toMatch(/feat\.txt/);
  });

  test("from='start' resolves to ref 0", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const query = createCheckpointDiffQuery(store);
    await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "x.txt"), "x\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 1 });
    const r = await query.getTurnDiff({ chatId: "c", cwd, from: "start", to: 1 });
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.sections[0]!.diff).toMatch(/x\.txt/);
  });

  test("to='latest' resolves to the highest-numbered ref", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const query = createCheckpointDiffQuery(store);
    await store.captureTurn({ chatId: "c", cwd, turn: 0 });
    fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 1 });
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    await store.captureTurn({ chatId: "c", cwd, turn: 2 });
    const r = await query.getTurnDiff({ chatId: "c", cwd, from: 0, to: "latest" });
    expect(r.sections[0]!.diff).toMatch(/a\.txt/);
    expect(r.sections[0]!.diff).toMatch(/b\.txt/);
  });

  test("missing refs → empty sections (no throw)", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const query = createCheckpointDiffQuery(store);
    const r = await query.getTurnDiff({ chatId: "missing", cwd, from: 99, to: 100 });
    expect(r.sections).toEqual([]);
  });

  test("non-git cwd → empty sections", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-diffq-bare-")));
    const store = createCheckpointStore();
    const query = createCheckpointDiffQuery(store);
    const r = await query.getTurnDiff({ chatId: "c", cwd, from: 0, to: 1 });
    expect(r.sections).toEqual([]);
  });
});
