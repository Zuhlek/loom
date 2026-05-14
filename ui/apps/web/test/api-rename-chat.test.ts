/**
 * `lib/api.ts` wire types + `renameChat` client helper.
 *
 * Behaviour tests for the extension to `ApiChat` (the two new fields
 * `custom_name` and `auto_title`) and for the new `renameChat(id,
 * customName)` helper that wraps `POST /chats/rename`.
 *
 * Each test installs a `vi.spyOn(globalThis, "fetch")` stub, calls
 * the client, then asserts both the constructed Request (URL, method,
 * body, headers) and the returned/parsed response payload.
 *
 * Error semantics: a non-2xx response surfaces as a rejected promise
 * carrying the server's `{ error }` payload (no silent swallow),
 * matching the `ApiError` shape used by every other helper.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  renameChat,
  type ApiChat,
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

function makeChat(overrides: Partial<ApiChat> = {}): ApiChat {
  return {
    id: "chat-1",
    project_id: null,
    cwd: "/wt",
    permission_mode: "default",
    worktree_mode: "local",
    worktree_path: null,
    session_id: null,
    pid: null,
    last_opened: "2026-05-13T00:00:00.000Z",
    pinned: false,
    resume_banner_dismissed: false,
    inert: false,
    created_at: "2026-05-13T00:00:00.000Z",
    custom_name: null,
    auto_title: null,
    ...overrides,
  };
}

let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("ApiChat wire shape", () => {
  test("exposes custom_name and auto_title as string | null", () => {
    const chat: ApiChat = makeChat({ custom_name: "named", auto_title: "first prompt" });
    expect(chat.custom_name).toBe("named");
    expect(chat.auto_title).toBe("first prompt");

    const cleared: ApiChat = makeChat({ custom_name: null, auto_title: null });
    expect(cleared.custom_name).toBeNull();
    expect(cleared.auto_title).toBeNull();
  });
});

describe("renameChat — happy path (US-002 wire half)", () => {
  test("POSTs /chats/rename?id=<id> with { customName } body and resolves to the decorated chat", async () => {
    const decorated = makeChat({ custom_name: "foo", auto_title: "first prompt" });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ chat: decorated }));

    const result = await renameChat("chat-1", "foo");

    const { url, init } = readCall();
    expect(url).toBe("/api/chats/rename?id=chat-1");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ customName: "foo" });
    expect(result).toEqual(decorated);
    expect(result.custom_name).toBe("foo");
  });

  test("URL-encodes the chat id", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ chat: makeChat({ id: "a/b c" }) }));

    await renameChat("a/b c", "foo");

    const { url } = readCall();
    expect(url).toBe("/api/chats/rename?id=a%2Fb%20c");
  });

  test("customName=null is forwarded verbatim and the resolved chat has custom_name === null", async () => {
    const decorated = makeChat({ custom_name: null, auto_title: "first prompt" });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ chat: decorated }));

    const result = await renameChat("chat-1", null);

    const { init } = readCall();
    expect(JSON.parse(init?.body as string)).toEqual({ customName: null });
    expect(result.custom_name).toBeNull();
  });
});

describe("renameChat — error semantics (US-006 wire half)", () => {
  test("400 (length cap) rejects with the server's { error } payload preserved", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "customName too long" }, 400));

    await expect(renameChat("chat-1", "x".repeat(81))).rejects.toMatchObject({
      body: { error: "customName too long" },
      status: 400,
    });
  });

  test("404 (chat not found) rejects with the server's { error } payload preserved", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "chat not found" }, 404));

    await expect(renameChat("missing", "foo")).rejects.toMatchObject({
      body: { error: "chat not found" },
      status: 404,
    });
  });
});
