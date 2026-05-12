/**
 * T-003 — `process-manager/resolve-spawn-cwd.ts` helper (US-002).
 *
 * Drives the helper with stubbed `isGitRepo` + `createWorktree` deps
 * across the five behaviour branches enumerated in the task spec.
 */
import { describe, expect, test } from "vitest";
import {
  resolveSpawnCwd,
  type ResolveSpawnCwdDeps,
  type SpawnInput,
} from "../src/process-manager/resolve-spawn-cwd.ts";

function inputFor(overrides: Partial<SpawnInput["chat"]> = {}): SpawnInput {
  return {
    chat: {
      id: "chat-abc12345",
      cwd: "/tmp/repo",
      worktree_mode: "local",
      ...overrides,
    },
    config: { worktreesRoot: null },
  };
}

function deps(overrides: Partial<ResolveSpawnCwdDeps> = {}): ResolveSpawnCwdDeps {
  return {
    isGitRepo: () => ({ isGit: false }),
    createWorktree: async () => "/never",
    ...overrides,
  };
}

describe("T-003 resolveSpawnCwd — local mode is a no-op", () => {
  test("returns cwd unchanged and worktreePath=null when worktree_mode === local", async () => {
    const result = await resolveSpawnCwd(
      inputFor({ worktree_mode: "local" }),
      deps(),
    );
    expect(result).toEqual({
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: null,
    });
  });
});

describe("T-003 resolveSpawnCwd — non-git cwd falls back to local", () => {
  test("returns the bare cwd with fallbackReason='not-a-repo' when worktree_mode='worktree' and cwd is not a git repo", async () => {
    const result = await resolveSpawnCwd(
      inputFor({ worktree_mode: "worktree" }),
      deps({ isGitRepo: () => ({ isGit: false }) }),
    );
    expect(result.cwd).toBe("/tmp/repo");
    expect(result.worktreePath).toBeNull();
    expect(result.fallbackReason).toBe("not-a-repo");
    expect(typeof result.fallbackDetail).toBe("string");
    expect(result.fallbackDetail!.length).toBeGreaterThan(0);
  });
});

describe("T-003 resolveSpawnCwd — worktree create succeeds", () => {
  test("returns the worktree path as cwd when createWorktree resolves", async () => {
    let captured: { parentCwd: string; worktreePath: string; newBranch: string } | null = null;
    const result = await resolveSpawnCwd(
      inputFor({ worktree_mode: "worktree", cwd: "/tmp/repo", id: "chat-abc12345" }),
      deps({
        isGitRepo: () => ({ isGit: true, repoName: "repo", topLevel: "/tmp/repo" }),
        createWorktree: async (opts) => {
          captured = opts;
          return opts.worktreePath;
        },
      }),
    );
    expect(result.fallbackReason).toBeNull();
    expect(result.worktreePath).not.toBeNull();
    expect(result.cwd).toBe(result.worktreePath);
    // Path layout: <worktreesRoot>/<chat-name>/<sha8>. The
    // <sha8> is derived from the chat id and is 8 hex chars.
    expect(captured).not.toBeNull();
    expect(captured!.worktreePath).toMatch(/\/chat-abc12345\/[0-9a-f]{8}$/);
    expect(captured!.newBranch).toMatch(/^loom\/chat-abc12345$/);
    // Default worktreesRoot when config.worktreesRoot is null is
    // `<topLevel>/.loom-worktrees`.
    expect(captured!.worktreePath.startsWith("/tmp/repo/.loom-worktrees/")).toBe(true);
  });

  test("config.worktreesRoot wins when set", async () => {
    let captured: { worktreePath: string } | null = null;
    await resolveSpawnCwd(
      {
        chat: {
          id: "chat-z",
          cwd: "/tmp/repo",
          worktree_mode: "worktree",
        },
        config: { worktreesRoot: "/custom/wt" },
      },
      deps({
        isGitRepo: () => ({ isGit: true, repoName: "repo", topLevel: "/tmp/repo" }),
        createWorktree: async (opts) => {
          captured = opts;
          return opts.worktreePath;
        },
      }),
    );
    expect(captured!.worktreePath.startsWith("/custom/wt/")).toBe(true);
  });
});

describe("T-003 resolveSpawnCwd — worktree create fails", () => {
  test("returns the bare cwd with fallbackReason='create-failed' when createWorktree throws", async () => {
    const err = new Error("git worktree add failed: fatal: ...");
    const result = await resolveSpawnCwd(
      inputFor({ worktree_mode: "worktree" }),
      deps({
        isGitRepo: () => ({ isGit: true, repoName: "repo", topLevel: "/tmp/repo" }),
        createWorktree: async () => {
          throw err;
        },
      }),
    );
    expect(result.cwd).toBe("/tmp/repo");
    expect(result.worktreePath).toBeNull();
    expect(result.fallbackReason).toBe("create-failed");
    expect(result.fallbackDetail).toContain("git worktree add failed");
  });
});

describe("T-003 resolveSpawnCwd — never throws", () => {
  test("any thrown error in createWorktree is contained as a fallback", async () => {
    await expect(
      resolveSpawnCwd(
        inputFor({ worktree_mode: "worktree" }),
        deps({
          isGitRepo: () => ({ isGit: true, topLevel: "/tmp/repo" }),
          createWorktree: async () => {
            throw new Error("kaboom");
          },
        }),
      ),
    ).resolves.toMatchObject({
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: "create-failed",
    });
  });

  test("worktreePath is null when fallbackReason is set; non-null when worktree mode succeeded", async () => {
    const failed = await resolveSpawnCwd(
      inputFor({ worktree_mode: "worktree" }),
      deps({ isGitRepo: () => ({ isGit: false }) }),
    );
    expect(failed.worktreePath).toBeNull();
    expect(failed.fallbackReason).not.toBeNull();

    const ok = await resolveSpawnCwd(
      inputFor({ worktree_mode: "worktree" }),
      deps({
        isGitRepo: () => ({ isGit: true, topLevel: "/tmp/repo" }),
        createWorktree: async (o) => o.worktreePath,
      }),
    );
    expect(ok.worktreePath).not.toBeNull();
    expect(ok.fallbackReason).toBeNull();
  });
});
