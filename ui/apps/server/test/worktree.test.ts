import { describe, expect, test } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createWorktree, executeGit, listWorktrees, getStatus, sanitizeBranchSegment, GitCommandError } from "../src/git/worktree";

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "loom-wt-"));
  spawnSync("git", ["init", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@loom"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Loom Test"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

describe("worktree manager", () => {
  test("executeGit returns stdout for a known command", async () => {
    const repo = makeRepo();
    const { stdout } = await executeGit(repo, ["--version"]);
    expect(stdout).toMatch(/^git version /);
    rmSync(repo, { recursive: true });
  });

  test("executeGit rejects on non-zero exit by default", async () => {
    const repo = makeRepo();
    await expect(executeGit(repo, ["nope"])).rejects.toBeInstanceOf(GitCommandError);
    rmSync(repo, { recursive: true });
  });

  test("listWorktrees returns the main repo on a fresh init", async () => {
    const repo = makeRepo();
    const wts = await listWorktrees(repo);
    expect(wts.length).toBeGreaterThanOrEqual(1);
    expect(wts[0]?.isMain).toBe(true);
    rmSync(repo, { recursive: true });
  });

  test("getStatus on a fresh empty repo reports clean", async () => {
    const repo = makeRepo();
    const status = await getStatus(repo);
    expect(status.isRepo).toBe(true);
    expect(status.hasWorkingTreeChanges).toBe(false);
    expect(status.branch).toBe("main");
    rmSync(repo, { recursive: true });
  });

  test("getStatus on a non-repo returns isRepo=false", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loom-non-"));
    const status = await getStatus(dir);
    expect(status.isRepo).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("createWorktree is idempotent when worktree + branch already exist", async () => {
    const repo = makeRepo();
    const wtPath = path.join(repo, ".wt", "feature");
    const first = await createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/feature" });
    expect(first).toBe(wtPath);
    const second = await createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/feature" });
    expect(second).toBe(wtPath);
    rmSync(repo, { recursive: true });
  });

  test("createWorktree attaches to an orphaned branch (worktree removed, branch lingering)", async () => {
    const repo = makeRepo();
    const wtPath = path.join(repo, ".wt", "orphan");
    await createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/orphan" });
    // Simulate the worktree dir being wiped without `git worktree remove`.
    rmSync(wtPath, { recursive: true });
    await executeGit(repo, ["worktree", "prune"]);
    // Branch still exists; re-resolving must attach instead of `-b`.
    const reused = await createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/orphan" });
    expect(reused).toBe(wtPath);
    const wts = await listWorktrees(repo);
    const wtReal = realpathSync(wtPath);
    expect(wts.some((w) => realpathSync(w.path) === wtReal)).toBe(true);
    rmSync(repo, { recursive: true });
  });

  test("createWorktree rejects when the path is checked out to a different branch", async () => {
    const repo = makeRepo();
    const wtPath = path.join(repo, ".wt", "conflict");
    await createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/expected" });
    await expect(
      createWorktree({ parentCwd: repo, worktreePath: wtPath, newBranch: "loom/other" }),
    ).rejects.toBeInstanceOf(GitCommandError);
    rmSync(repo, { recursive: true });
  });

  test("sanitizeBranchSegment normalizes user input", () => {
    expect(sanitizeBranchSegment("Plan: deploy~workflow ?")).toBe("plan--deploy-workflow");
    expect(sanitizeBranchSegment("  ..weird..name..")).toBe("weird-name");
    expect(sanitizeBranchSegment("ALL CAPS")).toBe("all-caps");
  });
});
