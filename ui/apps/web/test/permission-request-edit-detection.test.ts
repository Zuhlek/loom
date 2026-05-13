/**
 * T-003 — `detectEditToolArgs` helper + render swap inside
 * `PermissionRequestInline.tsx` (US-001, US-002, US-003).
 *
 * Vitest runtime here is `node` and the include glob is
 * `apps/** /test/** /*.test.ts` only (see `ui/vitest.config.ts`); no
 * jsdom / testing-library available. Tests for the detection helper
 * are executed directly through a dynamic import (the helper is a
 * pure function). The render-shape contract is asserted via
 * static-source grep on `PermissionRequestInline.tsx`, matching the
 * precedent set by `diff-file-card.test.ts` and
 * `diff-panel-controlled-scope.test.ts` for T-002.
 *
 * What is asserted:
 *
 *   - `detectEditToolArgs` is exported from
 *     `PermissionRequestInline.tsx` (so tests can call it directly).
 *   - Edit-shaped args `{file_path, old_string, new_string}` → returns
 *     `{ kind: "edit", filePath, oldString, newString }`.
 *   - Write-shaped args `{file_path, content}` and NOT Edit-shaped →
 *     returns `{ kind: "write", filePath, content }`.
 *   - Bash-shaped args `{command}` → returns `null`.
 *   - Ambiguous prompt "Edit this file" + Bash args → returns `null`
 *     (shape-first wins on mismatch — prompt is tie-breaker only).
 *   - The render body of `PermissionRequestInline` imports
 *     `InlineEditDiff` and calls `detectEditToolArgs(args, prompt)`,
 *     then branches between `<InlineEditDiff>` and the existing
 *     args `<pre>` block.
 *   - Header pill ("PermissionRequest"), prompt text, reason badge,
 *     and the four action buttons (Cancel turn / Decline /
 *     Always allow this session / Approve once) are still present
 *     in the JSX source after the swap.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const inlinePath = webRoot + "src/components/chat/PermissionRequestInline.tsx";
const inlineEditDiffPath = webRoot + "src/components/chat/InlineEditDiff.tsx";

describe("T-003 detectEditToolArgs — shape-first detection", () => {
  test("Edit-shaped args → { kind: 'edit', filePath, oldString, newString }", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    const result = mod.detectEditToolArgs(
      {
        file_path: "/abs/src/a.ts",
        old_string: "foo\nbar",
        new_string: "foo\nbaz",
      },
      "Edit file",
    );
    expect(result).toEqual({
      kind: "edit",
      filePath: "/abs/src/a.ts",
      oldString: "foo\nbar",
      newString: "foo\nbaz",
    });
  });

  test("Write-shaped args (file_path + content, no Edit fields) → { kind: 'write', filePath, content }", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    const result = mod.detectEditToolArgs(
      {
        file_path: "/abs/src/new.ts",
        content: "a\nb\nc",
      },
      "Write file",
    );
    expect(result).toEqual({
      kind: "write",
      filePath: "/abs/src/new.ts",
      content: "a\nb\nc",
    });
  });

  test("Bash-shaped args { command } → null (prompt irrelevant)", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    expect(
      mod.detectEditToolArgs({ command: "ls" }, "Run a shell command"),
    ).toBeNull();
  });

  test("ambiguous prompt 'Edit this file' + Bash args → null (shape-first beats prompt)", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    expect(
      mod.detectEditToolArgs({ command: "ls" }, "Edit this file"),
    ).toBeNull();
  });

  test("missing required Edit fields → null even with file_path present", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    expect(
      mod.detectEditToolArgs(
        { file_path: "/abs/src/a.ts", old_string: "x" },
        "Edit",
      ),
    ).toBeNull();
  });

  test("non-string field values → null (shape check requires string types)", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    expect(
      mod.detectEditToolArgs(
        { file_path: "/abs/a.ts", old_string: 42, new_string: "y" },
        "Edit",
      ),
    ).toBeNull();
  });

  test("Edit-shape takes precedence when both Edit and content fields are present", async () => {
    const mod = await import("../src/components/chat/PermissionRequestInline");
    const result = mod.detectEditToolArgs(
      {
        file_path: "/abs/src/a.ts",
        old_string: "o",
        new_string: "n",
        content: "ignored",
      },
      "Edit",
    );
    expect(result).toEqual({
      kind: "edit",
      filePath: "/abs/src/a.ts",
      oldString: "o",
      newString: "n",
    });
  });
});

describe("T-003 PermissionRequestInline — render swap surface", () => {
  test("PermissionRequestInline.tsx exists at the documented path", () => {
    expect(existsSync(inlinePath)).toBe(true);
  });

  test("InlineEditDiff is imported into PermissionRequestInline", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/InlineEditDiff["']/);
    expect(src).toMatch(/\bInlineEditDiff\b/);
  });

  test("PermissionRequestInline calls detectEditToolArgs(args, prompt)", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/detectEditToolArgs\s*\(\s*args\s*,\s*prompt\s*\)/);
  });

  test("the swap branches between <InlineEditDiff> and the existing args <pre>", () => {
    const src = readFileSync(inlinePath, "utf8");
    // The new branch renders <InlineEditDiff ... /> when detection is
    // non-null. The fallback <pre> remains for non-detected args.
    expect(src).toMatch(/<InlineEditDiff\b/);
    expect(src).toMatch(/<pre\b/);
  });

  test("<InlineEditDiff> is wired with edit-mode props (filePath / oldString / newString)", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/mode=\{?\s*["']edit["']/);
    expect(src).toMatch(/filePath=/);
    expect(src).toMatch(/oldString=/);
    expect(src).toMatch(/newString=/);
  });

  test("<InlineEditDiff> is wired with write-mode props (filePath / content)", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/mode=\{?\s*["']write["']/);
    expect(src).toMatch(/content=/);
  });

  test("header pill (PermissionRequest), prompt, reason badge survive the swap", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toContain("PermissionRequest");
    expect(src).toMatch(/\{\s*prompt\s*\}/);
    expect(src).toMatch(/\{\s*reason\s*\}/);
  });

  test("four action buttons (Cancel turn / Decline / Always allow / Approve once) survive the swap", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toContain("Cancel turn");
    expect(src).toContain("Decline");
    expect(src).toContain("Always allow this session");
    expect(src).toContain("Approve once");
  });
});

describe("T-003 EditDetection — type export", () => {
  test("EditDetection type is exported", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/export\s+type\s+EditDetection\b/);
  });

  test("detectEditToolArgs is exported", () => {
    const src = readFileSync(inlinePath, "utf8");
    expect(src).toMatch(/export\s+function\s+detectEditToolArgs\b/);
  });
});

describe("T-003 InlineEditDiff — file exists (sanity precondition for swap)", () => {
  test("InlineEditDiff.tsx exists at the documented path", () => {
    expect(existsSync(inlineEditDiffPath)).toBe(true);
  });
});
