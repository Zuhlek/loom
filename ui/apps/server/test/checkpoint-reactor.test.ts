import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createCheckpointStore } from "../src/checkpointing/checkpoint-store.ts";
import { createCheckpointReactor } from "../src/checkpointing/checkpoint-reactor.ts";
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-reactor-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@x"]);
  git(root, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "README.md"), "hi\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

describe("CheckpointReactor (T-015)", () => {
  test("captureTurn writes ref and emits checkpoint-captured frame", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const frames: ServerFrame[] = [];
    const reactor = createCheckpointReactor({
      store,
      emit: (f) => frames.push(f),
    });
    fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
    await reactor.captureTurn("c1", 1, cwd);
    const showRef = git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/1"]);
    expect(showRef.status).toBe(0);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe("checkpoint-captured");
    expect((frames[0] as any).body.turn).toBe(1);
  });

  test("non-git cwd → no ref, no frame, no throw", async () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-reactor-bare-")));
    const store = createCheckpointStore();
    const frames: ServerFrame[] = [];
    const reactor = createCheckpointReactor({ store, emit: (f) => frames.push(f) });
    await expect(reactor.captureTurn("c1", 1, cwd)).resolves.not.toThrow();
    expect(frames).toHaveLength(0);
  });

  test("captureTurn throws → reactor logs and does not rethrow", async () => {
    const fakeStore = {
      captureTurn: vi.fn(async () => {
        throw new Error("simulated");
      }),
      resolveRef: vi.fn(),
      listTurns: vi.fn(),
    } as any;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reactor = createCheckpointReactor({ store: fakeStore, emit: () => {} });
    await expect(reactor.captureTurn("c1", 1, "/tmp")).resolves.not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  test("two captures in sequence → both refs written", async () => {
    const cwd = track(makeGitRepo());
    const store = createCheckpointStore();
    const reactor = createCheckpointReactor({ store, emit: () => {} });
    fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
    await reactor.captureTurn("c1", 1, cwd);
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    await reactor.captureTurn("c1", 2, cwd);
    expect(git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/1"]).status).toBe(0);
    expect(git(cwd, ["show-ref", "--verify", "refs/loom-checkpoints/c1/2"]).status).toBe(0);
  });
});
