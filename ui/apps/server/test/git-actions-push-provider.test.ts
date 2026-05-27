// Follow-up 1 — POST /git/push routes through provider.pushBranch
// per ADR-006 when the configured `origin` matches a registered
// provider host; falls back to generic `git push` otherwise.
//
// Tests inject `getProvider` and `getRemoteUrl` deps into
// `mountGitActionsRoute` so we exercise routing without spinning up
// real GitHub / Bitbucket CLIs. Generic fallback uses a tmpdir repo
// with a bare-remote `origin` so the actual `git push` succeeds.
import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { mountGitActionsRoute } from "../src/routes/git-actions.ts";
import { ProviderAuthError } from "../src/source-control/errors.ts";

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

const tmpRoots: string[] = [];
function track(p: string): string {
  tmpRoots.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
  tmpRoots.length = 0;
  vi.clearAllMocks();
});

function makeFakeProvider(kind: "github" | "bitbucket") {
  return {
    kind,
    matches: () => true,
    createPr: vi.fn(async () => ({ url: "x", number: 1 })),
    listChangeRequests: vi.fn(async () => []),
    getChangeRequest: vi.fn(async () => ({
      number: 1,
      url: "x",
      title: "t",
      state: "open" as const,
      sourceBranch: "s",
      targetBranch: "t",
    })),
    checkoutChangeRequest: vi.fn(async () => ({ branch: "b", headSha: "h" })),
    pushBranch: vi.fn(async () => undefined),
    getRepositoryCloneUrls: vi.fn(async () => ({ https: "h", ssh: "s" })),
    createRepository: vi.fn(async () => ({ cloneUrl: "c" })),
    getDefaultBranch: vi.fn(async () => "main"),
  };
}

function makeRepoWithBareRemote(remoteUrl: string): { workdir: string; remote: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-push-provider-"));
  const workdir = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(workdir);
  git(workdir, ["init", "-q", "-b", "main"]);
  git(workdir, ["config", "user.email", "t@x"]);
  git(workdir, ["config", "user.name", "t"]);
  fs.writeFileSync(path.join(workdir, "a.txt"), "a\n");
  git(workdir, ["add", "a.txt"]);
  git(workdir, ["commit", "-q", "-m", "init"]);
  spawnSync("git", ["init", "--bare", "-q", "-b", "main", remote], { encoding: "utf8" });
  // origin URL is whatever the test wants. For the generic-fallback
  // case we need it to actually push, so callers can override the URL
  // after the bare-remote is bootstrapped.
  git(workdir, ["remote", "add", "origin", remoteUrl]);
  track(root);
  return { workdir, remote };
}

function call(handler: Handler, urlStr: string, init?: RequestInit): Promise<Response> {
  const req = new Request(urlStr, init);
  return Promise.resolve(handler(req, new URL(req.url)));
}

describe("POST /git/push — provider routing (Follow-up 1)", () => {
  test("GitHub origin → github.pushBranch invoked, status 200", async () => {
    const github = makeFakeProvider("github");
    const bitbucket = makeFakeProvider("bitbucket");
    const getProvider = vi.fn((url: string) => {
      if (/github\.com/.test(url)) return github;
      if (/bitbucket\.org/.test(url)) return bitbucket;
      return null;
    });
    const getRemoteUrl = vi.fn(async () => "https://github.com/owner/repo.git");

    const { workdir } = makeRepoWithBareRemote("https://github.com/owner/repo.git");
    const routes: Record<string, Handler> = {};
    mountGitActionsRoute(routes, { getProvider, getRemoteUrl });

    const res = await call(routes["/git/push"]!, "http://x/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir, setUpstream: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(getProvider).toHaveBeenCalledWith("https://github.com/owner/repo.git");
    expect(github.pushBranch).toHaveBeenCalledTimes(1);
    const call0 = github.pushBranch.mock.calls[0]![0];
    expect(call0).toMatchObject({
      cwd: workdir,
      branch: "main",
      remote: "origin",
      setUpstream: true,
    });
    expect(bitbucket.pushBranch).not.toHaveBeenCalled();
  });

  test("Bitbucket origin → bitbucket.pushBranch invoked, status 200", async () => {
    const github = makeFakeProvider("github");
    const bitbucket = makeFakeProvider("bitbucket");
    const getProvider = vi.fn((url: string) => {
      if (/github\.com/.test(url)) return github;
      if (/bitbucket\.org/.test(url)) return bitbucket;
      return null;
    });
    const getRemoteUrl = vi.fn(async () => "https://bitbucket.org/owner/repo.git");

    const { workdir } = makeRepoWithBareRemote("https://bitbucket.org/owner/repo.git");
    const routes: Record<string, Handler> = {};
    mountGitActionsRoute(routes, { getProvider, getRemoteUrl });

    const res = await call(routes["/git/push"]!, "http://x/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir }),
    });
    expect(res.status).toBe(200);
    expect(bitbucket.pushBranch).toHaveBeenCalledTimes(1);
    expect(github.pushBranch).not.toHaveBeenCalled();
  });

  test("GitLab (no matching provider) → generic git push fallback, status 200", async () => {
    // Build a real bare remote and point origin at it; the generic
    // path must reach the real `git push` and succeed.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-push-fallback-"));
    track(root);
    const workdir = path.join(root, "work");
    const remote = path.join(root, "remote.git");
    fs.mkdirSync(workdir);
    git(workdir, ["init", "-q", "-b", "main"]);
    git(workdir, ["config", "user.email", "t@x"]);
    git(workdir, ["config", "user.name", "t"]);
    fs.writeFileSync(path.join(workdir, "a.txt"), "a\n");
    git(workdir, ["add", "a.txt"]);
    git(workdir, ["commit", "-q", "-m", "init"]);
    spawnSync("git", ["init", "--bare", "-q", "-b", "main", remote], { encoding: "utf8" });
    // Real origin is a local bare repo (so push works); the URL the
    // dep returns to the route is the gitlab.com URL we want
    // classified.
    git(workdir, ["remote", "add", "origin", remote]);
    // Establish upstream tracking so a plain `git push` (no branch
    // arg) succeeds — mirrors the real-world case after first push.
    git(workdir, ["push", "-q", "-u", "origin", "main"]);
    fs.writeFileSync(path.join(workdir, "a.txt"), "a\nb\n");
    git(workdir, ["add", "a.txt"]);
    git(workdir, ["commit", "-q", "-m", "second"]);

    const github = makeFakeProvider("github");
    const bitbucket = makeFakeProvider("bitbucket");
    const getProvider = vi.fn((url: string) => {
      if (/github\.com/.test(url)) return github;
      if (/bitbucket\.org/.test(url)) return bitbucket;
      return null;
    });
    // Inject a remote URL that does NOT match any provider — the
    // route must fall back to the generic push path.
    const getRemoteUrl = vi.fn(async () => "https://gitlab.com/owner/repo.git");

    const routes: Record<string, Handler> = {};
    mountGitActionsRoute(routes, { getProvider, getRemoteUrl });

    const res = await call(routes["/git/push"]!, "http://x/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir, setUpstream: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(getProvider).toHaveBeenCalledWith("https://gitlab.com/owner/repo.git");
    expect(github.pushBranch).not.toHaveBeenCalled();
    expect(bitbucket.pushBranch).not.toHaveBeenCalled();
    // Generic fallback actually pushed to the bare remote.
    const branches = git(workdir, ["branch", "-r"]);
    expect(branches.stdout).toMatch(/origin\/main/);
  });

  test("provider.pushBranch throws ProviderAuthError → 401 with code: 'provider-auth'", async () => {
    const github = makeFakeProvider("github");
    github.pushBranch.mockImplementation(async () => {
      throw new ProviderAuthError("github auth env not set");
    });
    const getProvider = vi.fn(() => github);
    const getRemoteUrl = vi.fn(async () => "https://github.com/owner/repo.git");

    const { workdir } = makeRepoWithBareRemote("https://github.com/owner/repo.git");
    const routes: Record<string, Handler> = {};
    mountGitActionsRoute(routes, { getProvider, getRemoteUrl });

    const res = await call(routes["/git/push"]!, "http://x/git/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: workdir }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("provider-auth");
    expect(body.error).toMatch(/auth env not set/i);
  });
});
