// Tests for POST /git/commit and /git/push — branch toolbar actions.
// POST /git/pr lives in source-control-rpc.ts; coverage is in
// source-control-route.test.ts.
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { mountGitActionsRoute } from "../src/routes/git-actions.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

function makeRoutes(): Record<string, Handler> {
  const routes: Record<string, Handler> = {};
  mountGitActionsRoute(routes);
  return routes;
}

function call(handler: Handler, urlStr: string, init?: RequestInit): Promise<Response> {
  const req = new Request(urlStr, init);
  return Promise.resolve(handler(req, new URL(req.url)));
}

function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function makeRepoWithStagedChange(): { workdir: string; remote?: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-git-actions-"));
  const workdir = path.join(root, "work");
  fs.mkdirSync(workdir);
  git(workdir, ["init", "-q", "-b", "main"]);
  git(workdir, ["config", "user.email", "test@example.com"]);
  git(workdir, ["config", "user.name", "Test"]);
  // initial commit so HEAD exists
  fs.writeFileSync(path.join(workdir, "README.md"), "hello\n");
  git(workdir, ["add", "README.md"]);
  git(workdir, ["commit", "-q", "-m", "init"]);
  // new staged change for the commit test
  fs.writeFileSync(path.join(workdir, "feature.txt"), "feature body\n");
  git(workdir, ["add", "feature.txt"]);
  return { workdir };
}

function makeRepoWithBareRemote(): { workdir: string; remote: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-git-actions-push-"));
  const workdir = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(workdir);
  git(workdir, ["init", "-q", "-b", "main"]);
  git(workdir, ["config", "user.email", "test@example.com"]);
  git(workdir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(workdir, "a.txt"), "a\n");
  git(workdir, ["add", "a.txt"]);
  git(workdir, ["commit", "-q", "-m", "init"]);
  // bare remote
  const init = spawnSync("git", ["init", "--bare", "-q", "-b", "main", remote], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`bare init failed: ${init.stderr}`);
  git(workdir, ["remote", "add", "origin", remote]);
  // Configure the branch to track origin/main so a plain `git push` (no
  // branch arg) succeeds. This mirrors the real-world case: by the time
  // /git/push fires the worktree has been pushed at least once.
  fs.writeFileSync(path.join(workdir, "a.txt"), "a\nb\n");
  git(workdir, ["add", "a.txt"]);
  git(workdir, ["commit", "-q", "-m", "second"]);
  git(workdir, ["push", "-q", "-u", "origin", "main"]);
  // Add another local commit so /git/push has something fresh to send.
  fs.writeFileSync(path.join(workdir, "a.txt"), "a\nb\nc\n");
  git(workdir, ["add", "a.txt"]);
  git(workdir, ["commit", "-q", "-m", "third"]);
  return { workdir, remote };
}

const tmpRoots: string[] = [];
function track(workdir: string): string {
  tmpRoots.push(path.dirname(workdir));
  return workdir;
}

afterEach(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
  vi.clearAllMocks();
});

describe("POST /git/commit", () => {
  test("commits a staged change and returns { sha }", async () => {
    const { workdir } = makeRepoWithStagedChange();
    track(workdir);
    const routes = makeRoutes();
    const res = await call(routes["/git/commit"], "http://localhost/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir, message: "feat: x" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.sha).toBe("string");
    expect(body.sha.length).toBeGreaterThanOrEqual(7);
    const log = git(workdir, ["log", "-1", "--pretty=%H%n%s"]);
    expect(log.status).toBe(0);
    const [headSha, subject] = log.stdout.trim().split("\n");
    expect(headSha).toBe(body.sha);
    expect(subject).toBe("feat: x");
  });

  test("missing message returns 400", async () => {
    const { workdir } = makeRepoWithStagedChange();
    track(workdir);
    const routes = makeRoutes();
    const res = await call(routes["/git/commit"], "http://localhost/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("message required");
  });

  test("missing worktreePath returns 400", async () => {
    const routes = makeRoutes();
    const res = await call(routes["/git/commit"], "http://localhost/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "feat: x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("worktreePath required");
  });
});

describe("POST /git/push", () => {
  test("pushes to a local bare remote and returns { ok: true }", async () => {
    const { workdir } = makeRepoWithBareRemote();
    track(workdir);
    const routes = makeRoutes();
    const res = await call(routes["/git/push"], "http://localhost/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir, setUpstream: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Verify the remote actually has the branch now.
    const branches = git(workdir, ["branch", "-r"]);
    expect(branches.stdout).toMatch(/origin\/main/);
  });

  test("missing worktreePath returns 400", async () => {
    const routes = makeRoutes();
    const res = await call(routes["/git/push"], "http://localhost/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("worktreePath required");
  });
});

describe("M1 — /git/pr is not registered by git-actions (de-duplication)", () => {
  test("mountGitActionsRoute does NOT register /git/pr", () => {
    const routes = makeRoutes();
    expect(routes["/git/pr"]).toBeUndefined();
  });
});
