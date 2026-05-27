import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createHeadWatcher } from "../src/git/head-watcher.ts";
import type { RefChangeFrame } from "../src/chat-protocol/frames.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
function makeGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-headwatch-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  return root;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

function makeBus(): { emit: ReturnType<typeof vi.fn>; frames: RefChangeFrame[] } {
  const frames: RefChangeFrame[] = [];
  const emit = vi.fn((frame: any) => {
    if (frame && frame.kind === "ref-change") frames.push(frame);
  });
  return { emit, frames };
}

describe("HeadWatcher (T-009)", () => {
  test("N subscribers on the same cwd → only one fs.watch fd opened", () => {
    const cwd = track(makeGitDir());
    let opens = 0;
    const closeSpy = vi.fn();
    const fakeFsWatch: typeof fs.watch = ((..._args: any[]) => {
      opens += 1;
      return { close: closeSpy, on: vi.fn() } as unknown as fs.FSWatcher;
    }) as any;
    const { emit } = makeBus();
    const watcher = createHeadWatcher({ emit, fsWatch: fakeFsWatch });
    const subs = [
      watcher.watch(cwd),
      watcher.watch(cwd),
      watcher.watch(cwd),
      watcher.watch(cwd),
      watcher.watch(cwd),
    ];
    expect(opens).toBe(1);
    subs.forEach((s) => s.unsubscribe());
    watcher.dispose();
  });

  test("HEAD change → emits ref-change frame with new branch", async () => {
    const cwd = track(makeGitDir());
    // Inject a controllable fake fs.watch so we don't depend on host-OS
    // watch latency (macOS tmpdir watches are unreliable). The fake
    // captures the callback and we invoke it after mutating HEAD.
    let triggerWatch: () => void = () => {};
    const fakeFsWatch: typeof fs.watch = ((_p: any, cb: any) => {
      triggerWatch = cb;
      return { close: vi.fn(), on: vi.fn() } as unknown as fs.FSWatcher;
    }) as any;
    const { emit, frames } = makeBus();
    const watcher = createHeadWatcher({ emit, debounceMs: 10, fsWatch: fakeFsWatch });
    const sub = watcher.watch(cwd);
    fs.writeFileSync(path.join(cwd, ".git/HEAD"), "ref: refs/heads/feature-x\n");
    triggerWatch();
    await new Promise((r) => setTimeout(r, 50));
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const last = frames[frames.length - 1]!;
    expect(last.body.cwd).toBe(cwd);
    expect(last.body.branch).toBe("feature-x");
    sub.unsubscribe();
    watcher.dispose();
  });

  test("refcount unsubscribe → fs.watch.close called once after all unsubscribed", () => {
    const cwd = track(makeGitDir());
    const closeSpy = vi.fn();
    const fakeFsWatch: typeof fs.watch = ((..._args: any[]) => {
      return { close: closeSpy, on: vi.fn() } as unknown as fs.FSWatcher;
    }) as any;
    const { emit } = makeBus();
    const watcher = createHeadWatcher({ emit, fsWatch: fakeFsWatch });
    const a = watcher.watch(cwd);
    const b = watcher.watch(cwd);
    a.unsubscribe();
    expect(closeSpy).not.toHaveBeenCalled();
    b.unsubscribe();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });

  test("rapid HEAD writes within debounce window collapse to one emission", async () => {
    const cwd = track(makeGitDir());
    let triggerWatch: () => void = () => {};
    const fakeFsWatch: typeof fs.watch = ((_p: any, cb: any) => {
      triggerWatch = cb;
      return { close: vi.fn(), on: vi.fn() } as unknown as fs.FSWatcher;
    }) as any;
    const { emit, frames } = makeBus();
    const watcher = createHeadWatcher({ emit, debounceMs: 80, fsWatch: fakeFsWatch });
    const sub = watcher.watch(cwd);
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(cwd, ".git/HEAD"), `ref: refs/heads/rapid-${i}\n`);
      triggerWatch();
    }
    // Within the debounce window only one read should fire; the read
    // observes the latest on-disk value (rapid-4).
    await new Promise((r) => setTimeout(r, 200));
    expect(frames.length).toBe(1);
    expect(frames[0]!.body.branch).toBe("rapid-4");
    sub.unsubscribe();
    watcher.dispose();
  });

  test("invalid HEAD contents → no crash, no emission", async () => {
    const cwd = track(makeGitDir());
    let triggerWatch: () => void = () => {};
    const fakeFsWatch: typeof fs.watch = ((_p: any, cb: any) => {
      triggerWatch = cb;
      return { close: vi.fn(), on: vi.fn() } as unknown as fs.FSWatcher;
    }) as any;
    const { emit, frames } = makeBus();
    const watcher = createHeadWatcher({ emit, debounceMs: 10, fsWatch: fakeFsWatch });
    const sub = watcher.watch(cwd);
    fs.writeFileSync(path.join(cwd, ".git/HEAD"), "garbage-not-a-ref\n");
    triggerWatch();
    await new Promise((r) => setTimeout(r, 100));
    expect(frames.length).toBe(0);
    sub.unsubscribe();
    watcher.dispose();
  });

  test("fs.watch throwing → falls back to polling and still emits", async () => {
    const cwd = track(makeGitDir());
    const fakeFsWatch: typeof fs.watch = ((..._args: any[]) => {
      throw new Error("ENOSYS");
    }) as any;
    const { emit, frames } = makeBus();
    const watcher = createHeadWatcher({
      emit,
      debounceMs: 10,
      pollMs: 50,
      fsWatch: fakeFsWatch,
    });
    const sub = watcher.watch(cwd);
    fs.writeFileSync(path.join(cwd, ".git/HEAD"), "ref: refs/heads/poll-target\n");
    await new Promise((r) => setTimeout(r, 300));
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[frames.length - 1]!.body.branch).toBe("poll-target");
    sub.unsubscribe();
    watcher.dispose();
  });
});
