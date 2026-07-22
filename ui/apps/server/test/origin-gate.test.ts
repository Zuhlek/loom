/**
 * Origin gate: localhost is always allowed; extra origins come from
 * LOOM_ALLOWED_ORIGINS and the Coder/code-server VSCODE_PROXY_URI
 * ({{port}} → `*` glob). Host globs match a single subdomain label.
 */
import { describe, expect, test } from "vitest";
import { __test__, resolveAllowedOrigins } from "../src/http-ws-server.ts";

const { isLocalhostOrigin, originEntryMatches } = __test__;

describe("isLocalhostOrigin", () => {
  test("no Origin header ⇒ allowed (curl et al.)", () => {
    expect(isLocalhostOrigin(null, [])).toBe(true);
  });

  test("localhost / 127.0.0.1 / ::1 always allowed", () => {
    expect(isLocalhostOrigin("http://localhost:5173", [])).toBe(true);
    expect(isLocalhostOrigin("http://127.0.0.1:5173", [])).toBe(true);
    expect(isLocalhostOrigin("http://[::1]:5173", [])).toBe(true);
  });

  test("non-local origin rejected when not in allow-list", () => {
    expect(isLocalhostOrigin("https://evil.example.com", [])).toBe(false);
  });

  test("exact full-origin allow-list entry", () => {
    expect(
      isLocalhostOrigin("https://app.example.com", ["https://app.example.com"]),
    ).toBe(true);
  });

  test("bare host allow-list entry", () => {
    expect(isLocalhostOrigin("https://app.example.com", ["app.example.com"])).toBe(true);
  });

  test("host glob matches proxied port, one label only", () => {
    const glob = "*--main--general--tristankoller.cde.platform.cinnamon-services.ch";
    expect(
      isLocalhostOrigin(
        "https://5174--main--general--tristankoller.cde.platform.cinnamon-services.ch",
        [glob],
      ),
    ).toBe(true);
    expect(
      isLocalhostOrigin(
        "https://3737--main--general--tristankoller.cde.platform.cinnamon-services.ch",
        [glob],
      ),
    ).toBe(true);
    // `*` must not cross a dot into a different host.
    expect(
      isLocalhostOrigin(
        "https://evil.5174--main--general--tristankoller.cde.platform.cinnamon-services.ch",
        [glob],
      ),
    ).toBe(false);
  });
});

describe("originEntryMatches", () => {
  test("full-origin entry does not loosely match host", () => {
    expect(
      originEntryMatches("https://app.example.com", "https://other.com", "other.com"),
    ).toBe(false);
  });

  test("glob is case-insensitive on host", () => {
    expect(originEntryMatches("*.example.com", "https://API.EXAMPLE.COM", "API.EXAMPLE.COM")).toBe(
      true,
    );
  });
});

describe("resolveAllowedOrigins", () => {
  test("empty env ⇒ no extra origins (local dev unaffected)", () => {
    expect(resolveAllowedOrigins({})).toEqual([]);
  });

  test("LOOM_ALLOWED_ORIGINS split and trimmed", () => {
    expect(
      resolveAllowedOrigins({ LOOM_ALLOWED_ORIGINS: "https://a.com, b.com , " }),
    ).toEqual(["https://a.com", "b.com"]);
  });

  test("VSCODE_PROXY_URI {{port}} → host glob", () => {
    expect(
      resolveAllowedOrigins({
        VSCODE_PROXY_URI:
          "https://{{port}}--main--general--tristankoller.cde.platform.cinnamon-services.ch/",
      }),
    ).toEqual(["*--main--general--tristankoller.cde.platform.cinnamon-services.ch"]);
  });

  test("both sources combine", () => {
    const out = resolveAllowedOrigins({
      LOOM_ALLOWED_ORIGINS: "https://a.com",
      VSCODE_PROXY_URI: "https://{{port}}--ws.example.ch/",
    });
    expect(out).toEqual(["https://a.com", "*--ws.example.ch"]);
  });

  test("malformed VSCODE_PROXY_URI ignored", () => {
    expect(resolveAllowedOrigins({ VSCODE_PROXY_URI: "not a url" })).toEqual([]);
  });
});
