import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { executeGit, listWorktrees, getStatus, sanitizeBranchSegment, GitCommandError } from "../src/git/worktree";

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

  test("sanitizeBranchSegment normalizes user input", () => {
    expect(sanitizeBranchSegment("Plan: deploy~workflow ?")).toBe("plan--deploy-workflow");
    expect(sanitizeBranchSegment("  ..weird..name..")).toBe("weird-name");
    expect(sanitizeBranchSegment("ALL CAPS")).toBe("all-caps");
  });
});
