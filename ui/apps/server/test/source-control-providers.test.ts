import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as ghCli from "../src/source-control/github/gh-cli.ts";
import { githubProvider } from "../src/source-control/github/provider.ts";
import { bitbucketProvider } from "../src/source-control/bitbucket/provider.ts";
import { ProviderAuthError } from "../src/source-control/errors.ts";

afterEach(() => vi.restoreAllMocks());

describe("GitHub provider (T-004)", () => {
  test("createPr shells out to `gh pr create` and parses the URL", async () => {
    const spy = vi
      .spyOn(ghCli, "runGh")
      .mockResolvedValue("https://github.com/x/y/pull/77\n");
    const r = await githubProvider.createPr({
      cwd: "/p",
      remoteUrl: "https://github.com/x/y.git",
      head: "feat",
      base: "main",
      title: "t",
      body: "b",
    });
    expect(r.url).toBe("https://github.com/x/y/pull/77");
    expect(r.number).toBe(77);
    expect(spy).toHaveBeenCalled();
    const args = spy.mock.calls[0]![0];
    expect(args).toContain("pr");
    expect(args).toContain("create");
    expect(args).toContain("--head");
    expect(args).toContain("feat");
    expect(args).toContain("--base");
    expect(args).toContain("main");
  });

  test("listChangeRequests shells out and parses JSON", async () => {
    const stdout = JSON.stringify([
      {
        number: 5,
        url: "https://github.com/x/y/pull/5",
        title: "t",
        state: "OPEN",
        headRefName: "feat",
        baseRefName: "main",
      },
    ]);
    vi.spyOn(ghCli, "runGh").mockResolvedValue(stdout);
    const out = await githubProvider.listChangeRequests({ cwd: "/p", state: "open" });
    expect(out).toHaveLength(1);
    expect(out[0]!.number).toBe(5);
    expect(out[0]!.state).toBe("open");
    expect(out[0]!.sourceBranch).toBe("feat");
  });

  test("getChangeRequest shells out for a reference", async () => {
    const stdout = JSON.stringify({
      number: 9,
      url: "https://github.com/x/y/pull/9",
      title: "t",
      state: "MERGED",
      headRefName: "feat",
      baseRefName: "main",
    });
    vi.spyOn(ghCli, "runGh").mockResolvedValue(stdout);
    const out = await githubProvider.getChangeRequest({ cwd: "/p", reference: "9" });
    expect(out.number).toBe(9);
    expect(out.state).toBe("merged");
  });

  test("checkoutChangeRequest shells out `gh pr checkout`", async () => {
    const spy = vi
      .spyOn(ghCli, "runGh")
      .mockResolvedValueOnce("") // pr checkout
      .mockResolvedValueOnce("feat\n") // rev-parse --abbrev-ref HEAD via gh? no — gh isn't used
      .mockResolvedValue("");
    vi.spyOn(await import("../src/git/worktree.ts"), "executeGit").mockResolvedValue({
      stdout: "feat\n",
      stderr: "",
      exitCode: 0,
    });
    const r = await githubProvider.checkoutChangeRequest({ cwd: "/p", reference: "9" });
    expect(spy).toHaveBeenCalled();
    expect(r.branch).toBe("feat");
  });

  test("pushBranch shells out `gh` push", async () => {
    const executeGit = (await import("../src/git/worktree.ts")).executeGit;
    const spy = vi.spyOn(await import("../src/git/worktree.ts"), "executeGit").mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    await githubProvider.pushBranch({ cwd: "/p", branch: "feat" });
    expect(spy).toHaveBeenCalled();
    const args = spy.mock.calls[0]![1];
    expect(args[0]).toBe("push");
  });

  test("getRepositoryCloneUrls returns https + ssh shape", async () => {
    const stdout = JSON.stringify({ url: "https://github.com/x/y", sshUrl: "git@github.com:x/y.git" });
    vi.spyOn(ghCli, "runGh").mockResolvedValue(stdout);
    const r = await githubProvider.getRepositoryCloneUrls({ cwd: "/p" });
    expect(r.https).toBe("https://github.com/x/y");
    expect(r.ssh).toBe("git@github.com:x/y.git");
  });

  test("createRepository shells out and returns cloneUrl", async () => {
    vi.spyOn(ghCli, "runGh").mockResolvedValue(
      JSON.stringify({ url: "https://github.com/x/new" }),
    );
    const r = await githubProvider.createRepository({ name: "new", visibility: "private" });
    expect(r.cloneUrl).toBe("https://github.com/x/new");
  });

  test("getDefaultBranch shells out and returns the branch", async () => {
    vi.spyOn(ghCli, "runGh").mockResolvedValue(JSON.stringify({ defaultBranchRef: { name: "main" } }));
    const r = await githubProvider.getDefaultBranch({ cwd: "/p" });
    expect(r).toBe("main");
  });

  test("createPr surfaces gh stderr on non-zero exit", async () => {
    vi.spyOn(ghCli, "runGh").mockRejectedValue(new Error("gh: not authenticated"));
    await expect(
      githubProvider.createPr({
        cwd: "/p",
        remoteUrl: "https://github.com/x/y",
        head: "h",
        base: "main",
        title: "t",
      }),
    ).rejects.toThrow(/not authenticated/);
  });
});

describe("Bitbucket provider (T-004)", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    process.env.BITBUCKET_USERNAME = "u";
    process.env.BITBUCKET_APP_PASSWORD = "p";
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  test("createPr POSTs to /pullrequests with basic auth", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: 12, links: { html: { href: "https://bitbucket.org/x/y/pull-requests/12" } } }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    const r = await bitbucketProvider.createPr({
      cwd: "/p",
      remoteUrl: "https://bitbucket.org/x/y",
      head: "feat",
      base: "main",
      title: "t",
    });
    expect(r.url).toBe("https://bitbucket.org/x/y/pull-requests/12");
    expect(r.number).toBe(12);
    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/api\.bitbucket\.org/);
    expect((init as any).headers.Authorization).toMatch(/^Basic /);
  });

  test("missing env → ProviderAuthError on every method", async () => {
    delete process.env.BITBUCKET_USERNAME;
    delete process.env.BITBUCKET_APP_PASSWORD;
    const exec = await import("../src/git/worktree.ts");
    vi.spyOn(exec, "executeGit").mockResolvedValue({
      stdout: "https://bitbucket.org/x/y.git\n",
      stderr: "",
      exitCode: 0,
    });
    await expect(
      bitbucketProvider.createPr({ cwd: "/", remoteUrl: "https://bitbucket.org/x/y", head: "h", base: "m", title: "t" }),
    ).rejects.toThrow(ProviderAuthError);
    await expect(bitbucketProvider.listChangeRequests({ cwd: "/", state: "open" })).rejects.toThrow(
      ProviderAuthError,
    );
    await expect(bitbucketProvider.getChangeRequest({ cwd: "/", reference: "1" })).rejects.toThrow(
      ProviderAuthError,
    );
    await expect(bitbucketProvider.getDefaultBranch({ cwd: "/", repository: "x/y" })).rejects.toThrow(
      ProviderAuthError,
    );
  });

  test("listChangeRequests parses Bitbucket REST shape", async () => {
    const exec = await import("../src/git/worktree.ts");
    vi.spyOn(exec, "executeGit").mockResolvedValue({
      stdout: "https://bitbucket.org/x/y.git\n",
      stderr: "",
      exitCode: 0,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          values: [
            {
              id: 4,
              title: "t",
              state: "OPEN",
              links: { html: { href: "https://bitbucket.org/x/y/pull-requests/4" } },
              source: { branch: { name: "feat" } },
              destination: { branch: { name: "main" } },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const out = await bitbucketProvider.listChangeRequests({ cwd: "/p", state: "open" });
    expect(out).toHaveLength(1);
    expect(out[0]!.number).toBe(4);
    expect(out[0]!.sourceBranch).toBe("feat");
  });

  test("createPr surfaces non-2xx response as Error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 }),
    );
    await expect(
      bitbucketProvider.createPr({
        cwd: "/p",
        remoteUrl: "https://bitbucket.org/x/y",
        head: "h",
        base: "main",
        title: "t",
      }),
    ).rejects.toThrow(/bad|400/);
  });

  test("401 from Bitbucket surfaces as ProviderAuthError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "unauth" } }), { status: 401 }),
    );
    await expect(
      bitbucketProvider.getDefaultBranch({ cwd: "/p", repository: "x/y" }),
    ).rejects.toThrow(ProviderAuthError);
  });

  test("getDefaultBranch parses Bitbucket repo shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mainbranch: { name: "develop" } }), { status: 200 }),
    );
    const r = await bitbucketProvider.getDefaultBranch({ cwd: "/p", repository: "x/y" });
    expect(r).toBe("develop");
  });

  test("getRepositoryCloneUrls extracts https + ssh from clone links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          links: {
            clone: [
              { name: "https", href: "https://bitbucket.org/x/y.git" },
              { name: "ssh", href: "git@bitbucket.org:x/y.git" },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const r = await bitbucketProvider.getRepositoryCloneUrls({ cwd: "/p", repository: "x/y" });
    expect(r.https).toBe("https://bitbucket.org/x/y.git");
    expect(r.ssh).toBe("git@bitbucket.org:x/y.git");
  });

  test("createRepository POSTs and returns cloneUrl", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          links: { clone: [{ name: "https", href: "https://bitbucket.org/u/new.git" }] },
        }),
        { status: 201 },
      ),
    );
    const r = await bitbucketProvider.createRepository({ name: "new", visibility: "private" });
    expect(r.cloneUrl).toBe("https://bitbucket.org/u/new.git");
  });

  test("checkoutChangeRequest fetches PR and checks out source branch via executeGit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          source: { branch: { name: "feat" }, commit: { hash: "deadbeef" } },
        }),
        { status: 200 },
      ),
    );
    const exec = await import("../src/git/worktree.ts");
    const spy = vi.spyOn(exec, "executeGit").mockResolvedValue({
      stdout: "https://bitbucket.org/x/y.git\n",
      stderr: "",
      exitCode: 0,
    });
    const r = await bitbucketProvider.checkoutChangeRequest({ cwd: "/p", reference: "9" });
    expect(r.branch).toBe("feat");
    expect(r.headSha).toBe("deadbeef");
    expect(spy).toHaveBeenCalled();
  });

  test("pushBranch shells out via executeGit", async () => {
    const exec = await import("../src/git/worktree.ts");
    const spy = vi.spyOn(exec, "executeGit").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await bitbucketProvider.pushBranch({ cwd: "/p", branch: "feat" });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]![1][0]).toBe("push");
  });
});

describe("provider registry returns the real implementations", () => {
  test("getProvider('github.com/...') returns the new githubProvider instance", async () => {
    const { getProvider } = await import("../src/source-control/index.ts");
    expect(getProvider("https://github.com/x/y.git")).toBe(githubProvider);
  });

  test("getProvider('bitbucket.org/...') returns the new bitbucketProvider instance", async () => {
    const { getProvider } = await import("../src/source-control/index.ts");
    expect(getProvider("https://bitbucket.org/x/y.git")).toBe(bitbucketProvider);
  });
});
