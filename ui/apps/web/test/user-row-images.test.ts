/**
 * T-004 — UserRow image thumbnails (US-007 + ADR-D03 / ADR-006-mirror).
 *
 * Verifies UserRow inside `MessagesTimeline.tsx` renders a thumbnail
 * row above the text when `item.images?.length` is non-zero. Each
 * thumbnail is `<img src={"data:" + mediaType + ";base64," + dataB64}>`
 * — mirrors the inline data-URL pattern from `ToolResultMedia.tsx`
 * (ADR-006) and matches `tests.md` Gate G7.
 *
 * Test style: matches the project's node-only static-source contract
 * convention (vitest include glob `apps/** /test/** /*.test.ts`,
 * environment node, no JSDOM). Precedent in
 * `assistant-row-null-defense.test.ts`, `tool-result-media.test.ts`,
 * `working-chip.test.ts`. The `tests.md` G7 sketch mentions React
 * Testing Library but the repo has no RTL/JSDOM runtime; following
 * principles.md P2 "match existing test style" we assert on the
 * source-file render contract instead.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const timelinePath = webRoot + "src/components/chat/MessagesTimeline.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";

function readTimelineSource(): string {
  return readFileSync(timelinePath, "utf8");
}

/**
 * Extract the body of the `UserRow` function so assertions below can
 * scope to that component without false positives from elsewhere in
 * the file (e.g. the `AssistantRow` which already renders `<img>`-like
 * markup via its own paths).
 */
function readUserRowBlock(): string {
  const src = readTimelineSource();
  const start = src.indexOf("function UserRow");
  expect(start, "function UserRow should be present").toBeGreaterThan(-1);
  // Find the first `{` that opens the function body — i.e. the `{`
  // immediately after the `)` closing the parameter list. The arg
  // destructure `{ item }` has its own braces; we skip past them by
  // pairing with `}` first.
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
  // Skip whitespace + an optional return-type annotation up to the body `{`.
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) throw new Error("UserRow body `{` not found");
  // Walk to the matching `}` at depth 0.
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

describe("T-004 UserRow image thumbnails (US-007 + ADR-D03)", () => {
  test("MessagesTimeline.tsx exists at the documented path", () => {
    expect(existsSync(timelinePath)).toBe(true);
  });

  test("chat-types.ts declares the UserMessageImage type the row consumes", () => {
    const src = readFileSync(typesPath, "utf8");
    // UserMessageItem.images? threads UserMessageImage[] (T-001).
    expect(src).toMatch(/interface\s+UserMessageImage\b/);
    expect(src).toMatch(/images\?\s*:\s*UserMessageImage\[\]/);
  });

  test("UserRow renders an <img> element for each item.images entry", () => {
    const block = readUserRowBlock();
    // Renders <img> from item.images via .map (any of these spellings
    // would satisfy: `item.images.map`, `item.images?.map`,
    // `(item.images ?? []).map`).
    expect(block).toMatch(/item\.images[?\.\s]*\.?map\s*\(/);
    expect(block).toMatch(/<img\b/);
  });

  test("UserRow constructs a data:<mediaType>;base64,<dataB64> src (ADR-006 mirror)", () => {
    const block = readUserRowBlock();
    // Mirror of ToolResultMedia's data-URL transport: the src must
    // be a data URL keyed by mediaType + dataB64. No blob URLs.
    expect(block).toMatch(/data:\$\{[^}]*mediaType[^}]*\};base64,\$\{[^}]*dataB64[^}]*\}/);
    expect(block).not.toMatch(/createObjectURL/);
  });

  test("UserRow renders the thumbnail row above {item.text}", () => {
    const block = readUserRowBlock();
    const imgIdx = block.indexOf("<img");
    const textIdx = block.indexOf("{item.text}");
    expect(imgIdx, "UserRow should contain <img>").toBeGreaterThan(-1);
    expect(textIdx, "UserRow should contain {item.text}").toBeGreaterThan(-1);
    expect(imgIdx).toBeLessThan(textIdx);
  });

  test("legacy text-only render is preserved when item.images is absent or empty", () => {
    const block = readUserRowBlock();
    // The render guard is either a length check or `&&` short-circuit
    // on item.images. The exact spelling is implementation latitude;
    // assert the source declares a conditional guard rather than an
    // unconditional render of <img>.
    expect(block).toMatch(/item\.images\??[^}]*(?:length|\?\.)/);
  });
});
