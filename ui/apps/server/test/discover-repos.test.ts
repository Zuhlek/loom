import { describe, test, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverRepos } from "../src/git/discover-repos.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function mkroot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-repos-"));
  tmpDirs.push(root);
  return root;
}

/** Create a fake repo marker (a `.git` dir) at `dir`, mkdir-p first. */
function markRepo(dir: string): void {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
}

describe("discoverRepos", () => {
  test("a path outside any git repo → []", () => {
    const root = mkroot();
    expect(discoverRepos(root)).toEqual([]);
  });

  test("a git root with no nested repos → [root]", () => {
    const root = mkroot();
    markRepo(root);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    expect(discoverRepos(root)).toEqual([root]);
  });

  test("finds independent nested repos beneath the root", () => {
    const root = mkroot();
    markRepo(root);
    markRepo(path.join(root, "packages", "alpha"));
    fs.mkdirSync(path.join(root, "packages", "plain"), { recursive: true });

    const repos = discoverRepos(root).sort();
    expect(repos).toContain(root);
    expect(repos).toContain(path.join(root, "packages", "alpha"));
    expect(repos).not.toContain(path.join(root, "packages", "plain"));
  });

  test("prunes node_modules", () => {
    const root = mkroot();
    markRepo(root);
    markRepo(path.join(root, "node_modules", "dep"));
    expect(discoverRepos(root)).toEqual([root]);
  });

  test("does not descend into a discovered repo (no deeper nesting)", () => {
    const root = mkroot();
    markRepo(root);
    markRepo(path.join(root, "sub"));
    markRepo(path.join(root, "sub", "inner"));

    const repos = discoverRepos(root);
    expect(repos).toContain(path.join(root, "sub"));
    expect(repos).not.toContain(path.join(root, "sub", "inner"));
  });
});
