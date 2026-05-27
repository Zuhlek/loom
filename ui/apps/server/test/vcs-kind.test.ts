import { describe, test, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectVcsKind,
  invalidateVcsKindCache,
  __resetVcsKindCacheForTests,
  __getProbeCount,
} from "../src/git/vcs-kind.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  __resetVcsKindCacheForTests();
  vi.restoreAllMocks();
});

function makeGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-vcskind-git-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  return root;
}
function makeNonGitDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "loom-vcskind-bare-"));
}

describe("detectVcsKind (T-008)", () => {
  test("cwd with .git → 'git'", () => {
    const cwd = track(makeGitDir());
    expect(detectVcsKind(cwd)).toBe("git");
  });

  test("cwd without .git → 'unknown'", () => {
    const cwd = track(makeNonGitDir());
    expect(detectVcsKind(cwd)).toBe("unknown");
  });

  test("nested cwd inside a git repo → 'git' via ancestor walk", () => {
    const root = track(makeGitDir());
    const nested = path.join(root, "a", "b", "c");
    fs.mkdirSync(nested, { recursive: true });
    expect(detectVcsKind(nested)).toBe("git");
  });

  test("second call for the same cwd does not invoke fs (probe counter unchanged)", () => {
    const cwd = track(makeGitDir());
    detectVcsKind(cwd);
    const before = __getProbeCount();
    detectVcsKind(cwd);
    expect(__getProbeCount()).toBe(before);
  });

  test("invalidateVcsKindCache(cwd) → next call re-probes", () => {
    const cwd = track(makeGitDir());
    detectVcsKind(cwd);
    invalidateVcsKindCache(cwd);
    const before = __getProbeCount();
    detectVcsKind(cwd);
    expect(__getProbeCount()).toBeGreaterThan(before);
  });

  test("invalidateVcsKindCache() with no arg clears the entire cache", () => {
    const a = track(makeGitDir());
    const b = track(makeGitDir());
    detectVcsKind(a);
    detectVcsKind(b);
    invalidateVcsKindCache();
    const before = __getProbeCount();
    detectVcsKind(a);
    detectVcsKind(b);
    expect(__getProbeCount()).toBeGreaterThan(before);
  });

  test("detects .git as a file (gitfile / worktree HEAD)", () => {
    const root = track(makeNonGitDir());
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere\n");
    expect(detectVcsKind(root)).toBe("git");
  });
});
