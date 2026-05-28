/**
 * T-003 — http-ws-server `sanitizeUserTurnImages` (US-006 AC1).
 *
 * Verifies the defensive sanitiser that the WS `user-turn` handler runs
 * over `body.images` before forwarding to `bridge.submitUserTurn`.
 *
 * Per `tests.md` Gate G4:
 *   - undefined / non-array / empty array ⇒ undefined out
 *   - non-object entries dropped
 *   - missing / non-string `mediaType` dropped
 *   - missing / non-string `dataB64` dropped
 *   - array > 4 truncated to 4 (B-08 server-side cap)
 *   - 2 valid entries unchanged
 *
 * Test style: matches the rest of the server test suite — vitest +
 * node runtime, no jsdom. Imports the sanitiser directly from
 * `http-ws-server.ts` (exposed as a named export for unit-test access
 * per the task brief).
 */
import { describe, expect, test } from "vitest";
import { sanitizeUserTurnImages } from "../src/chat-protocol/sanitize-user-turn-images.ts";

describe("T-003 sanitizeUserTurnImages — defensive filter (US-006 AC1)", () => {
  test("undefined ⇒ undefined", () => {
    expect(sanitizeUserTurnImages(undefined)).toBeUndefined();
  });

  test("non-array (string) ⇒ undefined", () => {
    expect(sanitizeUserTurnImages("not an array")).toBeUndefined();
  });

  test("non-array (object) ⇒ undefined", () => {
    expect(sanitizeUserTurnImages({ mediaType: "image/png", dataB64: "AA==" })).toBeUndefined();
  });

  test("non-array (number) ⇒ undefined", () => {
    expect(sanitizeUserTurnImages(42)).toBeUndefined();
  });

  test("empty array ⇒ undefined", () => {
    expect(sanitizeUserTurnImages([])).toBeUndefined();
  });

  test("mixed entries: null / strings filtered out, valid object preserved", () => {
    const out = sanitizeUserTurnImages([
      null,
      "stringy",
      { mediaType: "image/png", dataB64: "AA==" },
    ]);
    expect(out).toBeDefined();
    expect(out!.length).toBe(1);
    expect(out![0].mediaType).toBe("image/png");
    expect(out![0].dataB64).toBe("AA==");
  });

  test("entry missing mediaType ⇒ dropped", () => {
    const out = sanitizeUserTurnImages([
      { dataB64: "AA==" },
      { mediaType: "image/png", dataB64: "BB==" },
    ]);
    expect(out!.length).toBe(1);
    expect(out![0].dataB64).toBe("BB==");
  });

  test("entry with non-string mediaType ⇒ dropped", () => {
    const out = sanitizeUserTurnImages([
      { mediaType: 42, dataB64: "AA==" },
      { mediaType: "image/png", dataB64: "BB==" },
    ]);
    expect(out!.length).toBe(1);
    expect(out![0].mediaType).toBe("image/png");
  });

  test("entry missing dataB64 ⇒ dropped", () => {
    const out = sanitizeUserTurnImages([
      { mediaType: "image/png" },
      { mediaType: "image/png", dataB64: "BB==" },
    ]);
    expect(out!.length).toBe(1);
    expect(out![0].dataB64).toBe("BB==");
  });

  test("entry with non-string dataB64 ⇒ dropped", () => {
    const out = sanitizeUserTurnImages([
      { mediaType: "image/png", dataB64: 12345 },
      { mediaType: "image/png", dataB64: "BB==" },
    ]);
    expect(out!.length).toBe(1);
  });

  test("array of 6 valid entries ⇒ truncated to 4 (B-08 cap)", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      mediaType: "image/png",
      dataB64: `D${i}==`,
    }));
    const out = sanitizeUserTurnImages(six);
    expect(out!.length).toBe(4);
    expect(out![3].dataB64).toBe("D3==");
  });

  test("array of 2 valid entries ⇒ returned unchanged", () => {
    const two = [
      { mediaType: "image/png", dataB64: "AA==", filename: "a.png" },
      { mediaType: "image/jpeg", dataB64: "BB==" },
    ];
    const out = sanitizeUserTurnImages(two);
    expect(out!.length).toBe(2);
    expect(out![0].mediaType).toBe("image/png");
    expect(out![0].dataB64).toBe("AA==");
    expect(out![0].filename).toBe("a.png");
    expect(out![1].mediaType).toBe("image/jpeg");
  });
});
