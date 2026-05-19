/**
 * T-002 — Web null-defense in AssistantRow (US-002 AC3, AC4, AC5).
 *
 * Static-source contract tests (vitest, node runtime). Project's vitest
 * include glob is `apps/** /test/** /*.test.ts` so the file extension is
 * `.ts` (not `.tsx`) — same convention as `working-chip.test.ts`.
 *
 * What we assert (US-002 AC3, AC4, AC5):
 *
 *   AC3 (filter before map): inside `AssistantRow`, the `item.blocks`
 *       render pipeline must include a `.filter(...)` step BEFORE the
 *       `.map(...)` that discriminates by block.type. The filter drops
 *       both null/undefined entries AND `_placeholder: true` entries
 *       (ADR-004) so the streaming caret arithmetic uses the FILTERED
 *       array's `arr.length - 1`, not `item.blocks.length`.
 *
 *   AC4 (optional chaining): every block-type discriminator in the
 *       AssistantRow render uses `block?.type` (optional chaining) or
 *       `block && block.type` — never bare `block.type`. Belt-and-
 *       suspenders against future bridge regressions that could ship a
 *       null/undefined entry past the filter.
 *
 *   AC5 (don't crash on malformed entries): falls out of AC3 + AC4 — no
 *       direct dereference happens before the filter strips bad entries.
 *
 *   Wire-shape compatibility (ADR-004): the `_placeholder?: boolean`
 *       field is declared on `AssistantTextBlock` in both
 *       `apps/web/src/lib/chat-types.ts` and the server's
 *       `chat-protocol/messages.ts` so the cross-cutting wire-mirror
 *       drift guard (`wire-mirror-drift.test.ts`) keeps passing.
 *
 * RED path: before this task lands, AssistantRow renders `item.blocks`
 * via a bare `.map((block, idx) => ...)` without a preceding filter, and
 * discriminates with `block.type` (no optional chain). The static
 * regexes below return false; runtime assertions fail.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const timelinePath = webRoot + "src/components/chat/MessagesTimeline.tsx";
const chatTypesPath = webRoot + "src/lib/chat-types.ts";

/**
 * Extract the body of the `function AssistantRow(...)` block by brace
 * balancing — handles nested JSX braces / object literals. Returns
 * `null` when the function is not present.
 */
function extractAssistantRowBody(src: string): string | null {
  const re = /function\s+AssistantRow\s*\([^)]*\)\s*\{/;
  const m = re.exec(src);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1; // position of the `{`
  let depth = 0;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

describe("T-002 / US-002 — AssistantRow filter before map (AC3)", () => {
  test("AssistantRow contains a .filter(...) call BEFORE the .map(...) on item.blocks", () => {
    const src = readFileSync(timelinePath, "utf8");
    const body = extractAssistantRowBody(src);
    expect(body).toBeTruthy();
    // Strict ordering: .filter must occur textually before .map within
    // AssistantRow body.
    const filterIdx = body!.search(/\.filter\s*\(/);
    const mapIdx = body!.search(/\.map\s*\(/);
    expect(filterIdx).toBeGreaterThan(-1);
    expect(mapIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeLessThan(mapIdx);
  });

  test("the filter predicate excludes null/undefined entries (block != null OR similar)", () => {
    const src = readFileSync(timelinePath, "utf8");
    const body = extractAssistantRowBody(src);
    expect(body).toBeTruthy();
    // Look for any of the canonical null-defensive predicates inside the
    // filter callback.
    const nullCheck =
      /block\s*!=\s*null/.test(body!) ||
      /block\s*!==\s*null\s*&&\s*block\s*!==\s*undefined/.test(body!) ||
      /Boolean\s*\(\s*block\s*\)/.test(body!);
    expect(nullCheck).toBe(true);
  });

  test("the filter predicate excludes `_placeholder: true` entries (ADR-004)", () => {
    const src = readFileSync(timelinePath, "utf8");
    const body = extractAssistantRowBody(src);
    expect(body).toBeTruthy();
    // The filter callback must reference `_placeholder` as a property
    // check on the block.
    expect(body!).toMatch(/_placeholder/);
  });
});

describe("T-002 / US-002 — optional chaining on block.type (AC4)", () => {
  test("AssistantRow uses optional chaining (`block?.type`) on EVERY block-type discriminator", () => {
    const src = readFileSync(timelinePath, "utf8");
    const body = extractAssistantRowBody(src);
    expect(body).toBeTruthy();
    // Every textual occurrence of `block.type` (without the optional `?`)
    // would be a regression — only `block?.type` is allowed inside
    // AssistantRow. Note: `block.type === "..."` MAY appear as
    // `block?.type === "..."` so we search for the bad bare form.
    const bareReferences = body!.match(/\bblock\.type\b/g) ?? [];
    expect(bareReferences.length).toBe(0);
    // And at least one positive `block?.type` discriminator exists.
    const optionalReferences = body!.match(/\bblock\?\.type\b/g) ?? [];
    expect(optionalReferences.length).toBeGreaterThan(0);
  });
});

describe("T-002 / US-002 — wire-mirror: _placeholder on AssistantTextBlock (ADR-004)", () => {
  test("apps/web chat-types.ts declares `_placeholder?: boolean` on AssistantTextBlock", () => {
    const src = readFileSync(chatTypesPath, "utf8");
    // Find the AssistantTextBlock interface and assert it carries the
    // optional `_placeholder?: boolean` field.
    const re =
      /interface\s+AssistantTextBlock\s*\{[\s\S]*?_placeholder\?\s*:\s*boolean[\s\S]*?\}/;
    expect(re.test(src)).toBe(true);
  });
});
