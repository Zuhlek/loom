/**
 * T-004 — GET /git/status route tests.
 *
 * Spawns a real temp git repo per test (mirrors worktree.test.ts), wires up
 * the route via mountGitStatusRoute, and asserts the response shape against
 * the contract from design.md:
 *
 *   GET /git/status?worktreePath=<abs>&base=<ref>
 *     200 { branch, base, ahead, behind, uncommitted, remote? }
 *     400 { error: "worktreePath required" }
 *     500 { error: <git failure message> }
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { mountGitStatusRoute } from "../src/routes/git-status.ts";

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "loom-git-status-"));
  spawnSync("git", ["init", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@loom"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Loom Test"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir });
  return dir;
}

function makeHandler() {
  const routes: Record<string, any> = {};
  mountGitStatusRoute(routes);
  return routes["/git/status"];
}

async function callRoute(handler: any, search: string) {
  const url = new URL(`http://localhost/git/status${search}`);
  const req = new Request(url.toString());
  const res = await handler(req, url);
  return { status: res.status, body: await res.json() };
}

describe("GET /git/status", () => {
  test("fresh repo with feat/x branch checked out reports clean state", async () => {
    const repo = makeRepo();
    try {
      spawnSync("git", ["checkout", "-b", "feat/x"], { cwd: repo });
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}`,
      );
      expect(status).toBe(200);
      expect(body.branch).toBe("feat/x");
      expect(body.base).toBe("main");
      expect(body.ahead).toBe(0);
      expect(body.behind).toBe(0);
      expect(body.uncommitted).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("one commit on feat/x past main → ahead: 1", async () => {
    const repo = makeRepo();
    try {
      spawnSync("git", ["checkout", "-b", "feat/x"], { cwd: repo });
      writeFileSync(path.join(repo, "a.txt"), "hello\n");
      spawnSync("git", ["add", "a.txt"], { cwd: repo });
      spawnSync("git", ["commit", "-m", "add a"], { cwd: repo });
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}`,
      );
      expect(status).toBe(200);
      expect(body.ahead).toBe(1);
      expect(body.behind).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("dirty working tree → uncommitted: true", async () => {
    const repo = makeRepo();
    try {
      writeFileSync(path.join(repo, "dirty.txt"), "uncommitted\n");
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}`,
      );
      expect(status).toBe(200);
      expect(body.uncommitted).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("?base= omitted defaults to 'main'", async () => {
    const repo = makeRepo();
    try {
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}`,
      );
      expect(status).toBe(200);
      expect(body.base).toBe("main");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("?base=develop honoured in response and counts", async () => {
    const repo = makeRepo();
    try {
      spawnSync("git", ["checkout", "-b", "develop"], { cwd: repo });
      writeFileSync(path.join(repo, "d.txt"), "develop\n");
      spawnSync("git", ["add", "d.txt"], { cwd: repo });
      spawnSync("git", ["commit", "-m", "develop commit"], { cwd: repo });
      spawnSync("git", ["checkout", "main"], { cwd: repo });
      spawnSync("git", ["checkout", "-b", "feat/y"], { cwd: repo });
      writeFileSync(path.join(repo, "y.txt"), "y\n");
      spawnSync("git", ["add", "y.txt"], { cwd: repo });
      spawnSync("git", ["commit", "-m", "y"], { cwd: repo });
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}&base=develop`,
      );
      expect(status).toBe(200);
      expect(body.base).toBe("develop");
      // feat/y has 1 commit not on develop; develop has 1 commit not on feat/y.
      expect(body.ahead).toBe(1);
      expect(body.behind).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("missing worktreePath → 400 with error message", async () => {
    const handler = makeHandler();
    const { status, body } = await callRoute(handler, "");
    expect(status).toBe(400);
    expect(body.error).toBe("worktreePath required");
  });

  test("non-repo directory → 500 with git failure message", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loom-non-repo-"));
    try {
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(dir)}`,
      );
      expect(status).toBe(500);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("response carries remote when origin is configured", async () => {
    const repo = makeRepo();
    try {
      spawnSync("git", ["remote", "add", "origin", "https://example.com/r.git"], { cwd: repo });
      const handler = makeHandler();
      const { status, body } = await callRoute(
        handler,
        `?worktreePath=${encodeURIComponent(repo)}`,
      );
      expect(status).toBe(200);
      expect(body.remote).toBe("https://example.com/r.git");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
