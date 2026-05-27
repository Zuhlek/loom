import { describe, test, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountSourceControlRoute } from "../src/routes/source-control-rpc.ts";
import { ProviderAuthError } from "../src/source-control/errors.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

function makeFakeProvider(kind: "github" | "bitbucket") {
  return {
    kind,
    matches: () => true,
    createPr: vi.fn(async () => ({ url: "https://x/pr/1", number: 1 })),
    listChangeRequests: vi.fn(async () => [
      { number: 5, url: "u", title: "t", state: "open" as const, sourceBranch: "s", targetBranch: "t" },
    ]),
    getChangeRequest: vi.fn(async () => ({
      number: 7,
      url: "u",
      title: "t",
      state: "open" as const,
      sourceBranch: "s",
      targetBranch: "t",
    })),
    checkoutChangeRequest: vi.fn(async () => ({ branch: "feat-cr", headSha: "deadbeef" })),
    pushBranch: vi.fn(async () => undefined),
    getRepositoryCloneUrls: vi.fn(async () => ({ https: "h", ssh: "s" })),
    createRepository: vi.fn(async () => ({ cloneUrl: "c" })),
    getDefaultBranch: vi.fn(async () => "main"),
  };
}

async function setup(opts: { remoteUrl?: string; provider?: any } = {}) {
  const store = await initMetadataStore({ inMemoryOnly: true });
  const frames: ServerFrame[] = [];
  const routes: Record<string, Handler> = {};
  const fakeProvider = opts.provider ?? makeFakeProvider("github");
  const getProviderMock = vi.fn(
    () => (opts.provider === null ? null : (opts.provider ?? fakeProvider)),
  );
  const getRemoteUrlMock = vi.fn(async () => opts.remoteUrl ?? "https://github.com/x/y.git");
  mountSourceControlRoute(routes, store, (f) => frames.push(f), {
    getProvider: getProviderMock as any,
    getRemoteUrl: getRemoteUrlMock as any,
  });
  return { store, frames, routes, fakeProvider, getProviderMock, getRemoteUrlMock };
}

function call(handler: Handler, url: string, init?: RequestInit) {
  return handler(new Request(url, init), new URL(url));
}

describe("GET /source-control/list-prs (T-014)", () => {
  test("returns provider data on a known remote", async () => {
    const { routes, fakeProvider } = await setup();
    const res = await call(
      routes["/source-control/list-prs"]!,
      `http://x/source-control/list-prs?cwd=${encodeURIComponent("/p")}&state=open&limit=10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.prs).toHaveLength(1);
    expect(fakeProvider.listChangeRequests).toHaveBeenCalled();
  });

  test("unknown-provider remote → 404 unsupported provider", async () => {
    const { routes } = await setup({ provider: null, remoteUrl: "https://example.invalid/x/y.git" });
    const res = await call(
      routes["/source-control/list-prs"]!,
      `http://x/source-control/list-prs?cwd=${encodeURIComponent("/p")}`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/unsupported provider/i);
  });
});

describe("GET /source-control/get-pr (T-014)", () => {
  test("returns provider data", async () => {
    const { routes, fakeProvider } = await setup();
    const res = await call(
      routes["/source-control/get-pr"]!,
      `http://x/source-control/get-pr?cwd=${encodeURIComponent("/p")}&reference=7`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.pr.number).toBe(7);
    expect(fakeProvider.getChangeRequest).toHaveBeenCalled();
  });

  test("missing reference → 400", async () => {
    const { routes } = await setup();
    const res = await call(
      routes["/source-control/get-pr"]!,
      `http://x/source-control/get-pr?cwd=${encodeURIComponent("/p")}`,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /source-control/checkout-cr (T-014)", () => {
  test("calls provider.checkoutChangeRequest + patches the row + emits frame", async () => {
    const { routes, store, frames, fakeProvider } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-checkoutcr-")));
    store.chats.create({ id: "c1", cwd: tmp });
    store.chats.update("c1", { vcs_kind: "git" });
    const res = await call(
      routes["/source-control/checkout-cr"]!,
      "http://x/source-control/checkout-cr",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: "c1", reference: "7" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.branch).toBe("feat-cr");
    expect(fakeProvider.checkoutChangeRequest).toHaveBeenCalled();
    expect(store.chats.get("c1")!.branch).toBe("feat-cr");
    expect(frames.some((f) => f.kind === "chat-meta-changed")).toBe(true);
  });

  test("vcs_kind === 'unknown' → 400", async () => {
    const { routes, store } = await setup();
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-checkoutcr-bare-")));
    store.chats.create({ id: "c1", cwd: tmp });
    store.chats.update("c1", { vcs_kind: "unknown" });
    const res = await call(
      routes["/source-control/checkout-cr"]!,
      "http://x/source-control/checkout-cr",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: "c1", reference: "7" }),
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /source-control/default-branch (T-014)", () => {
  test("calls provider.getDefaultBranch", async () => {
    const { routes, fakeProvider } = await setup();
    const res = await call(
      routes["/source-control/default-branch"]!,
      `http://x/source-control/default-branch?cwd=${encodeURIComponent("/p")}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.branch).toBe("main");
    expect(fakeProvider.getDefaultBranch).toHaveBeenCalled();
  });
});

describe("POST /git/pr routes through provider (T-014)", () => {
  test("Bitbucket remote → bitbucket.createPr invoked", async () => {
    const bitbucket = makeFakeProvider("bitbucket");
    const { routes, fakeProvider } = await setup({
      provider: bitbucket,
      remoteUrl: "https://bitbucket.org/x/y.git",
    });
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-pr-bb-")));
    const res = await call(routes["/git/pr"]!, "http://x/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: tmp, title: "t", head: "feat", base: "main" }),
    });
    expect(res.status).toBe(200);
    expect(bitbucket.createPr).toHaveBeenCalled();
  });

  test("unknown remote → 404 unsupported provider", async () => {
    const { routes } = await setup({
      provider: null,
      remoteUrl: "https://example.invalid/x/y.git",
    });
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-pr-bad-")));
    const res = await call(routes["/git/pr"]!, "http://x/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: tmp, title: "t", head: "feat", base: "main" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("M5 — ProviderAuthError surfaces as 401 unauthenticated", () => {
  test("createPr throws ProviderAuthError → POST /git/pr returns 401 with code: provider-auth", async () => {
    const authingProvider = makeFakeProvider("bitbucket");
    authingProvider.createPr.mockImplementation(async () => {
      throw new ProviderAuthError("Bitbucket auth env not set");
    });
    const { routes } = await setup({
      provider: authingProvider,
      remoteUrl: "https://bitbucket.org/x/y.git",
    });
    const tmp = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-pr-auth-")));
    const res = await call(routes["/git/pr"]!, "http://x/git/pr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktreePath: tmp, title: "t", head: "feat", base: "main" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("provider-auth");
    expect(body.error).toMatch(/auth env not set/i);
  });

  test("listChangeRequests ProviderAuthError → GET /source-control/list-prs returns 401", async () => {
    const authingProvider = makeFakeProvider("github");
    authingProvider.listChangeRequests.mockImplementation(async () => {
      throw new ProviderAuthError("not authenticated");
    });
    const { routes } = await setup({ provider: authingProvider });
    const res = await call(
      routes["/source-control/list-prs"]!,
      `http://x/source-control/list-prs?cwd=${encodeURIComponent("/p")}`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("provider-auth");
  });
});
