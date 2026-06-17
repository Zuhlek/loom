/**
 * T-006 — `lib/api.ts` wire types + client functions.
 *
 * Behaviour tests for the five client functions that wrap the new
 * /git/status, /diff, /git/commit, /git/push, /git/pr server routes.
 * Each test installs a `vi.spyOn(global, "fetch")` stub, calls the
 * client, then asserts both the constructed Request (URL, method,
 * body, headers) and the returned/parsed response payload.
 *
 * Error semantics: a non-2xx response surfaces as a rejected promise
 * carrying the server's `{ error }` payload (no silent swallow).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  getDiff,
  getGitStatus,
  postGitCommit,
  postGitPr,
  postGitPush,
  type ApiDiffResponse,
  type ApiDiffSection,
  type ApiGitStatus,
} from "../src/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readCall(idx = 0): { url: string; init?: RequestInit } {
  const call = fetchSpy.mock.calls[idx];
  if (!call) throw new Error(`fetch was not called (idx=${idx})`);
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);
  return { url, init };
}

// `vi.spyOn(globalThis, "fetch")` is well-typed in vitest 2.x but the
// returned MockInstance generic doesn't include the `fetch` overloads in
// a form Vitest's own `.mockResolvedValueOnce` accepts without a cast,
// so we type the holder as `any` and use it via the helpers below.
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("getGitStatus", () => {
  test("omits base so the server resolves the trunk; URL-encodes worktreePath, parses JSON body", async () => {
    const body: ApiGitStatus = {
      branch: "feat/x",
      base: "main",
      ahead: 1,
      behind: 0,
      uncommitted: false,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const result = await getGitStatus("/wt");

    const { url } = readCall();
    expect(url).toBe("/api/git/status?worktreePath=%2Fwt");
    expect(result).toEqual(body);
  });

  test("custom base appears in the query string", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        branch: "feat/x",
        base: "develop",
        ahead: 0,
        behind: 0,
        uncommitted: false,
      } satisfies ApiGitStatus),
    );

    await getGitStatus("/wt", "develop");

    const { url } = readCall();
    expect(url).toContain("base=develop");
  });

  test("non-2xx rejects with the server's { error } payload preserved", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "worktreePath required" }, 400));

    await expect(getGitStatus("")).rejects.toMatchObject({
      body: { error: "worktreePath required" },
      status: 400,
    });
  });
});

describe("getDiff", () => {
  test("sends only worktreePath — base is resolved server-side; response parsed", async () => {
    const body: ApiDiffResponse = {
      sections: [{ kind: "whole", label: "", diff: "diff --git ..." }],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const result = await getDiff("/wt");

    const { url } = readCall();
    expect(url).toBe("/api/diff?worktreePath=%2Fwt");
    // The base is the repo's fork point, resolved on the server — the client
    // sends no `base` param, and the legacy turn-scope `mode` toggle is gone.
    expect(url).not.toContain("base=");
    expect(url).not.toContain("mode=");
    expect(result).toEqual(body);
  });

  test("aborting the supplied signal rejects the promise", async () => {
    const ctrl = new AbortController();
    // Simulate fetch honouring AbortSignal: reject with an abort error
    // synchronously when called with an already-aborted signal, or when
    // the signal fires mid-flight.
    fetchSpy.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const promise = getDiff("/wt", { signal: ctrl.signal });
    ctrl.abort();
    await expect(promise).rejects.toThrow();

    const { init } = readCall();
    expect(init?.signal).toBe(ctrl.signal);
  });
});

describe("postGitCommit", () => {
  test("minimal body — POST to /api/git/commit; returns { sha }", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sha: "deadbeef" }));

    const result = await postGitCommit({ worktreePath: "/wt", message: "m" });

    const { url, init } = readCall();
    expect(url).toBe("/api/git/commit");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ worktreePath: "/wt", message: "m" });
    expect(result).toEqual({ sha: "deadbeef" });
  });

  test("optional body and paths appear in the POST body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sha: "cafef00d" }));

    await postGitCommit({
      worktreePath: "/wt",
      message: "m",
      body: "extra context",
      paths: ["a.ts", "b.ts"],
    });

    const { init } = readCall();
    expect(JSON.parse(init?.body as string)).toEqual({
      worktreePath: "/wt",
      message: "m",
      body: "extra context",
      paths: ["a.ts", "b.ts"],
    });
  });

  test("non-2xx rejects with the server's { error } payload preserved", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "message required" }, 400));

    await expect(
      postGitCommit({ worktreePath: "/wt", message: "" }),
    ).rejects.toMatchObject({ body: { error: "message required" }, status: 400 });
  });
});

describe("postGitPush", () => {
  test("setUpstream+forceWithLease appear in the POST body; { ok: true } preserved", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await postGitPush({
      worktreePath: "/wt",
      setUpstream: true,
      forceWithLease: true,
    });

    const { url, init } = readCall();
    expect(url).toBe("/api/git/push");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      worktreePath: "/wt",
      setUpstream: true,
      forceWithLease: true,
    });
    expect(result).toEqual({ ok: true });
  });

  test("5xx rejects with the server's { error } payload preserved (no flatten)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "remote rejected" }, 500));

    await expect(
      postGitPush({ worktreePath: "/wt" }),
    ).rejects.toMatchObject({ body: { error: "remote rejected" }, status: 500 });
  });
});

describe("postGitPr", () => {
  test("POST body matches; returns { url }", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ url: "https://example.test/owner/repo/pull/42" }),
    );

    const result = await postGitPr({ worktreePath: "/wt", title: "t" });

    const { url, init } = readCall();
    expect(url).toBe("/api/git/pr");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ worktreePath: "/wt", title: "t" });
    expect(result).toEqual({ url: "https://example.test/owner/repo/pull/42" });
  });

  test("optional body is forwarded to the POST body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ url: "x" }));

    await postGitPr({ worktreePath: "/wt", title: "t", body: "description" });

    const { init } = readCall();
    expect(JSON.parse(init?.body as string)).toEqual({
      worktreePath: "/wt",
      title: "t",
      body: "description",
    });
  });
});

describe("typecheck-only contract guard", () => {
  test("ApiDiffSection shape exposes kind/label/diff", () => {
    const section: ApiDiffSection = { kind: "whole", label: "main...HEAD", diff: "" };
    expect(section.kind).toBe("whole");
  });
});
