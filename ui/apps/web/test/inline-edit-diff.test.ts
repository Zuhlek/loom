/**
 * T-003 — `InlineEditDiff` component (US-001 AC2, US-002 AC2, US-010 AC1).
 *
 * Vitest runtime is `node`; no jsdom. The engine helpers
 * (`synthesizeEditDiff` / `synthesizeWriteDiff`) are pure and are
 * called directly to verify the data the component will hand to
 * `<DiffFileCard>`. The component's render-shape contract is asserted
 * via static-source grep on `InlineEditDiff.tsx`, matching the
 * precedent set by `diff-file-card.test.ts` for T-002.
 *
 * What is asserted:
 *
 *   - `InlineEditDiff.tsx` exists at the documented path and exports
 *     the component + the `InlineEditDiffProps` discriminated-union.
 *   - The component imports `DiffFileCard` from `../diff/DiffFileCard`
 *     and the two synthesizer helpers from `../../lib/diff-synthesize`.
 *   - For `mode="edit"`: the component calls `synthesizeEditDiff` with
 *     `{ filePath, oldString, newString }`. The engine output for the
 *     canonical fixture (oldString "foo\nbar", newString "foo\nbaz")
 *     produces one hunk: 1 context + 1 del + 1 add; +1/-1.
 *   - For `mode="write"`: the component calls `synthesizeWriteDiff`
 *     with `{ filePath, content }`. The engine output for content
 *     "a\nb\nc" produces status "added", three add lines, +3/-0.
 *   - The component renders `<DiffFileCard file={file} maxHeight="40vh">`
 *     — the slim variant contract.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import {
  synthesizeEditDiff,
  synthesizeWriteDiff,
} from "../src/lib/diff-synthesize";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const componentPath = webRoot + "src/components/chat/InlineEditDiff.tsx";

describe("T-003 InlineEditDiff — file exists + import surface", () => {
  test("InlineEditDiff.tsx exists at the documented path", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  test("imports DiffFileCard from ../diff/DiffFileCard", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\.\/diff\/DiffFileCard["']/);
    expect(src).toMatch(/\bDiffFileCard\b/);
  });

  test("imports synthesizeEditDiff and synthesizeWriteDiff from ../../lib/diff-synthesize", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\.\/\.\.\/lib\/diff-synthesize["']/);
    expect(src).toMatch(/\bsynthesizeEditDiff\b/);
    expect(src).toMatch(/\bsynthesizeWriteDiff\b/);
  });
});

describe("T-003 InlineEditDiff — props contract", () => {
  test("exports `InlineEditDiffProps` discriminated union (edit | write)", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/export\s+type\s+InlineEditDiffProps\b/);
    // Both arms must mention the `mode` discriminator.
    expect(src).toMatch(/mode\s*:\s*["']edit["']/);
    expect(src).toMatch(/mode\s*:\s*["']write["']/);
    // Edit arm carries filePath / oldString / newString.
    expect(src).toMatch(/filePath\s*:\s*string/);
    expect(src).toMatch(/oldString\s*:\s*string/);
    expect(src).toMatch(/newString\s*:\s*string/);
    // Write arm carries content.
    expect(src).toMatch(/content\s*:\s*string/);
  });

  test("exports the component `InlineEditDiff`", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/export\s+function\s+InlineEditDiff\b/);
  });
});

describe("T-003 InlineEditDiff — mode branching + engine calls", () => {
  test("component invokes synthesizeEditDiff for the edit branch", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/synthesizeEditDiff\s*\(/);
  });

  test("component invokes synthesizeWriteDiff for the write branch", () => {
    const src = readFileSync(componentPath, "utf8");
    expect(src).toMatch(/synthesizeWriteDiff\s*\(/);
  });

  test("component branches on mode === 'edit' / 'write'", () => {
    const src = readFileSync(componentPath, "utf8");
    // Either an explicit `mode === "edit"` check, or a destructure-narrow
    // pattern via the discriminated union.
    const hasModeBranch =
      /mode\s*===\s*["']edit["']/.test(src) ||
      /mode\s*===\s*["']write["']/.test(src);
    expect(hasModeBranch).toBe(true);
  });
});

describe("T-003 InlineEditDiff — DiffFileCard slim-variant render", () => {
  test("renders <DiffFileCard file={...} maxHeight='40vh' />", () => {
    const src = readFileSync(componentPath, "utf8");
    // The render must mount <DiffFileCard /> and pass maxHeight="40vh".
    expect(src).toMatch(/<DiffFileCard\b/);
    expect(src).toMatch(/maxHeight=\{?\s*["']40vh["']/);
    // The `file=` prop must be passed through.
    expect(src).toMatch(/file=\{/);
  });

  test("no scope toggle / totals strip (slim variant)", () => {
    const src = readFileSync(componentPath, "utf8");
    // The slim variant must not render the per-turn / whole toggle or
    // the totals strip that the full DiffPanel includes.
    expect(src).not.toMatch(/Per-turn/);
    expect(src).not.toMatch(/Whole conversation/);
  });
});

describe("T-003 engine output anchors (verified through direct synthesizer calls)", () => {
  test("edit fixture (oldString 'foo\\nbar', newString 'foo\\nbaz') → one hunk; +1/-1; context+del+add", () => {
    const file = synthesizeEditDiff({
      filePath: "/abs/src/a.ts",
      oldString: "foo\nbar",
      newString: "foo\nbaz",
    });
    expect(file.path).toBe("/abs/src/a.ts");
    expect(file.status).toBe("modified");
    expect(file.added).toBe(1);
    expect(file.removed).toBe(1);
    expect(file.hunks).toHaveLength(1);
    const flat = file.hunks.flat();
    expect(flat).toEqual([
      { kind: "context", text: "foo" },
      { kind: "del", text: "bar" },
      { kind: "add", text: "baz" },
    ]);
  });

  test("write fixture (content 'a\\nb\\nc') → status 'added'; +3/-0; three add lines", () => {
    const file = synthesizeWriteDiff({
      filePath: "/abs/src/new.ts",
      content: "a\nb\nc",
    });
    expect(file.path).toBe("/abs/src/new.ts");
    expect(file.status).toBe("added");
    expect(file.added).toBe(3);
    expect(file.removed).toBe(0);
    expect(file.hunks).toHaveLength(1);
    const flat = file.hunks.flat();
    expect(flat).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
      { kind: "add", text: "c" },
    ]);
  });
});
