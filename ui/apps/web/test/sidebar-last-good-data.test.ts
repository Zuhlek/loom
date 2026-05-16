/**
 * T-012 — Sidebar keeps last-good groups when /api/health fails
 * (US-005 AC3). Static-source assertion: the refresh() handler in
 * sidebar-state.tsx must NOT call setState(null) on error.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const sidebarStatePath = webRoot + "src/lib/sidebar-state.tsx";

describe("T-012 sidebar-state preserves last-good groups on fetch failure", () => {
  test("the catch branch does not clear state to null", () => {
    const src = readFileSync(sidebarStatePath, "utf8");
    // Pull the catch block.
    const catchIdx = src.indexOf("catch");
    expect(catchIdx).toBeGreaterThan(-1);
    // Walk to the matching closing brace via a brace-counter.
    let depth = 0;
    let start = src.indexOf("{", catchIdx);
    let end = start;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const block = src.slice(start, end);
    // Catch branch must not setState(null) — that would wipe the
    // last-good groups (US-005 AC3 forbids it).
    expect(/setState\s*\(\s*null\s*\)/.test(block)).toBe(false);
  });
});
