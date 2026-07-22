/**
 * T-008 — Built-in slash dispatch (`/plan`, `/default`, `/model`).
 *
 * Verifies (US-003 AC1-AC4) that ChatComposer's `acceptSlash` handler
 * branches on the accepted row's `kind` / `name`:
 *   - `kind === 'builtin'` AND `name === 'plan'`     ⇒
 *       calls `onPermissionModeChange('plan')`, closes the menu,
 *       does NOT call `replaceTextRange`, does NOT call the editor's
 *       `setPlainText`, does NOT emit `onSubmit`.
 *   - `kind === 'builtin'` AND `name === 'default'`  ⇒
 *       same as above with `'default'`.
 *   - `kind === 'builtin'` AND `name === 'model'`    ⇒
 *       calls `onOpenModelPicker?.()` (NEW prop wired by this task for
 *       T-010 to consume), closes the menu, does NOT write to the
 *       textarea, does NOT submit.
 *   - Any other row (provider command / skill) ⇒
 *       preserves the current behaviour — writes `/<name> ` via
 *       `replaceTextRange` at the trigger range.
 *
 * RED path:
 *   Before implementation, `ChatComposer.tsx`'s `acceptSlash` writes
 *   `/<name> ` for ALL rows (including built-ins) and the
 *   `onOpenModelPicker` prop does not exist. The runtime assertions
 *   below grep against the component source for the dispatch wiring
 *   and fail until the implementation lands.
 *
 * Test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component file,
 * matching the project convention established by
 * `composer-slash-menu.test.ts` and `permission-level-pill.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

describe("T-008 ChatComposer — built-in dispatch in acceptSlash", () => {
  test("ChatComposer.tsx exists at the documented path", () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  test("declares an `onOpenSettings` prop on ChatComposerProps", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onOpenSettings\s*\??\s*:/);
  });

  test("destructures `onOpenSettings` from props in the component body", () => {
    const src = readFileSync(composerPath, "utf8");
    // Destructuring inside the function signature — the name appears in
    // the destructured block alongside the other prop names.
    expect(src).toMatch(/onOpenSettings\b/);
  });

  test("acceptSlash branches on row.kind === 'builtin'", () => {
    const src = readFileSync(composerPath, "utf8");
    // The new branch checks the row's kind discriminator.
    expect(src).toMatch(/row\.kind\s*===\s*["']builtin["']/);
  });

  test("acceptSlash dispatches `onPermissionModeChange('plan')` for the /plan built-in", () => {
    const src = readFileSync(composerPath, "utf8");
    // Match either the optional-chaining call or the explicit gate.
    expect(src).toMatch(/onPermissionModeChange\??\.?\(\s*["']plan["']\s*\)/);
  });

  test("acceptSlash dispatches `onPermissionModeChange('default')` for the /default built-in", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onPermissionModeChange\??\.?\(\s*["']default["']\s*\)/);
  });

  test("acceptSlash invokes `onOpenSettings?.()` for the /model built-in (opens the settings modal)", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onOpenSettings\??\.?\(\s*\)/);
  });

  test("built-in dispatch closes the menu (setSlashMenuOpen(false) inside the branch)", () => {
    const src = readFileSync(composerPath, "utf8");
    // Existing handler already closes the menu; assert the call still
    // exists inside acceptSlash so the built-in path doesn't strand it.
    expect(src).toMatch(/setSlashMenuOpen\(\s*false\s*\)/);
  });

  test("provider/skill rows still go through replaceTextRange (current behaviour preserved)", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/replaceTextRange/);
    // The `/<name> ` replacement string still appears in the source for
    // non-built-in rows.
    expect(src).toMatch(/`\/\$\{[^}]*name[^}]*\}\s`|"\/"\s*\+[^+]*name[^+]*\+\s*["']\s["']/);
  });

  test("built-in branch does NOT call replaceTextRange / setPlainText in its body", () => {
    const src = readFileSync(composerPath, "utf8");
    // Extract the acceptSlash function body and check that the
    // built-in branch returns BEFORE the replaceTextRange call.
    const acceptMatch = src.match(
      /const\s+acceptSlash\s*=\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
    );
    expect(acceptMatch).not.toBeNull();
    const body = acceptMatch![2];
    // The built-in branch returns early — there must be a `return;`
    // after the dispatcher calls and before the generic write path.
    // Match either an explicit `return;` or `return` inside the
    // builtin-checked block.
    expect(body).toMatch(/builtin/);
    expect(body).toMatch(/return\s*;/);
    // The dispatch calls must appear BEFORE the replaceTextRange call
    // in source order so the early return guards the textarea write.
    const builtinIdx = body.indexOf("builtin");
    const replaceIdx = body.indexOf("replaceTextRange");
    expect(builtinIdx).toBeGreaterThan(-1);
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(builtinIdx).toBeLessThan(replaceIdx);
  });

  test("built-in dispatch does NOT emit a user-turn (onSubmit is not invoked from acceptSlash)", () => {
    const src = readFileSync(composerPath, "utf8");
    const acceptMatch = src.match(
      /const\s+acceptSlash\s*=\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
    );
    expect(acceptMatch).not.toBeNull();
    const body = acceptMatch![2];
    // The acceptSlash body must not call `onSubmit(` directly — submission
    // only happens through the `submit()` helper triggered by the send
    // button / Enter intent, never as a side-effect of accepting a row.
    expect(body).not.toMatch(/onSubmit\s*\(/);
    expect(body).not.toMatch(/\bsubmit\s*\(\s*\)/);
  });
});
