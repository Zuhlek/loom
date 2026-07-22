/**
 * T-006 — Web timeline renders past-turn images via the read-back route when
 * `dataB64` is absent (US-003 AC3 / design Open ambiguity #1).
 *
 * Test style follows the project's node-only static-source contract convention
 * (vitest include glob `apps/** /test/** /*.test.ts`, environment node, no
 * JSDOM). Precedent: `user-row-images.test.ts`, `assistant-row-null-defense.test.ts`.
 * Per principles.md P2 (match existing test style) we assert on the UserRow
 * source render contract rather than mounting React (no RTL/JSDOM runtime).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const timelinePath = webRoot + "src/components/chat/MessagesTimeline.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";
// Src resolution (inline data: URI vs /chat-image read-back) is centralised
// in lib/chat-images.ts (imageSrc); UserRow calls it and filters unresolved.
const chatImagesPath = webRoot + "src/lib/chat-images.ts";

function readUserRowBlock(): string {
  const src = readFileSync(timelinePath, "utf8");
  const start = src.indexOf("function UserRow");
  expect(start, "function UserRow should be present").toBeGreaterThan(-1);
  let i = start;
  let parenDepth = 0;
  let inParams = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") {
      parenDepth++;
      inParams = true;
    } else if (ch === ")") {
      parenDepth--;
      if (inParams && parenDepth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < src.length && src[i] !== "{") i++;
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("UserRow block not terminated");
}

describe("T-006 UserRow past-turn image read-back route", () => {
  test("chat-types.ts UserMessageImage carries an optional id and dataB64 is optional", () => {
    const src = readFileSync(typesPath, "utf8");
    // id?: string — the read-back addressing key set by the materializer.
    expect(src).toMatch(/id\?\s*:\s*string/);
    // dataB64 is now optional (absent on reattached past-turn images, ADR-002).
    expect(src).toMatch(/dataB64\?\s*:\s*string/);
  });

  test("imageSrc builds a /chat-image route src from chatId + id when dataB64 is absent", () => {
    const src = readFileSync(chatImagesPath, "utf8");
    // The route URL keyed by chatId + image id.
    expect(src).toMatch(/\/chat-image\?chatId=/);
    expect(src).toMatch(/id=/);
    // References the image id field.
    expect(src).toMatch(/\bimg\.id\b/);
  });

  test("imageSrc keeps the inline data: URI when dataB64 is present (no live-turn regression)", () => {
    const src = readFileSync(chatImagesPath, "utf8");
    expect(src).toMatch(/data:\$\{[^}]*mediaType[^}]*\};base64,\$\{[^}]*dataB64[^}]*\}/);
  });

  test("resolution guards against a broken <img> when neither dataB64 nor id is present", () => {
    const helper = readFileSync(chatImagesPath, "utf8");
    // imageSrc references the id field and can return undefined for images
    // lacking both sources.
    expect(helper).toMatch(/img\.id/);
    expect(helper).toMatch(/return\s+undefined/);
    // UserRow filters out unresolved images so no broken <img> is emitted.
    expect(readUserRowBlock()).toMatch(/filter/);
  });

  test("chatId is threaded into UserRow so the route URL can be built", () => {
    const src = readFileSync(timelinePath, "utf8");
    // UserRow receives chatId (either via props destructure or call site).
    expect(src).toMatch(/UserRow[\s\S]{0,80}chatId/);
  });
});
