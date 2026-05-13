/**
 * Tests for POST /git/commit, /git/push, /git/pr — branch toolbar actions.
 *
 * Uses a real local temp repo (file-based remote for push), and mocks the
 * source-control provider so /git/pr stays offline.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

// Mocks must be declared before the routes module is imported.
vi.mock("../src/source-control/index.ts", async () => {
  const actual: any = await vi.importActual("../src/source-control/index.ts");
  return {
    ...actual,
    getProvider: vi.fn((_remoteUrl: string) => ({
      name: "mock",
      matches: () => true,
      createPr: async (_args: any) => ({ url: "https://example.test/owner/repo/pull/42", number: 42 }),
    })),
  };
});

// eslint-disable-next-line import/first
import { mountGitActionsRoute } from "../src/routes/git-actions.ts";
// eslint-disable-next-line import/first
import * as sourceControl from "../src/source-control/index.ts";

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

function makeRepoWithRemoteForPr(): { workdir: string; remote: string } {
  // Same setup as bare-remote, but pushes once so we have a remote-tracked branch.
  const r = makeRepoWithBareRemote();
  // give the worktree a dirty file so commitAndPush has something to commit
  fs.writeFileSync(path.join(r.workdir, "b.txt"), "b\n");
  // push initial state so origin/main exists for subsequent PR
  git(r.workdir, ["push", "-q", "-u", "origin", "main"]);
  return r;
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

describe("POST /git/pr", () => {
  test("returns { url } when provider succeeds (mocked)", async () => {
    const { workdir } = makeRepoWithRemoteForPr();
    track(workdir);
    const routes = makeRoutes();
    const res = await call(routes["/git/pr"], "http://localhost/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir, title: "My PR" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://example.test/owner/repo/pull/42");
    expect(sourceControl.getProvider).toHaveBeenCalled();
  });

  test("missing title returns 400", async () => {
    const routes = makeRoutes();
    const res = await call(routes["/git/pr"], "http://localhost/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: "/tmp/anything" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("title required");
  });

  test("missing worktreePath returns 400", async () => {
    const routes = makeRoutes();
    const res = await call(routes["/git/pr"], "http://localhost/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("worktreePath required");
  });
});
