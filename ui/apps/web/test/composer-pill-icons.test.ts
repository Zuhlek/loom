/**
 * T-018 — Icon + constant consolidation (M-01, M-02, M-03).
 *
 * Asserts:
 *   1. `composer-pill-icons.tsx` exists and exports
 *      `ChevronDownIcon`, `ShieldIcon`, `ClipboardListIcon`,
 *      `PenLineIcon`, `LockOpenIcon`, `ModeIconProps`.
 *   2. The three pill components no longer carry private
 *      `ChevronDownIcon` definitions — the chevron SVG path literal
 *      `M6 9l6 6 6-6` appears only in the shared module.
 *   3. `PermissionLevelPill.tsx` no longer carries private
 *      `ShieldIcon` / `PenLineIcon` / `LockOpenIcon` definitions.
 *
 * The pre-cutover ULTRATHINK_BUDGET_TOKENS assertion (against the
 * deleted `claude-session-bridge.ts`) is gone — the constant was a
 * SDK-bridge legacy and the bridge file no longer exists post-T-021.
 *
 * Test runtime is `node` (no jsdom). Assertions are static-source
 * string-grep against the source files, matching the project's
 * existing pill-test convention.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

const sharedPath = webRoot + "src/components/chat/composer-pill-icons.tsx";
const permissionPath = webRoot + "src/components/chat/PermissionLevelPill.tsx";
const modelSelectorPath = webRoot + "src/components/chat/ModelSelectorPill.tsx";
const modelSettingsPath = webRoot + "src/components/chat/ModelSettingsPill.tsx";
const chatComposerPath = webRoot + "src/components/chat/ChatComposer.tsx";

const CHEVRON_PATH_LITERAL = 'M6 9l6 6 6-6';

describe("T-018 composer-pill-icons — shared icon module + bridge constant cleanup", () => {
  test("composer-pill-icons.tsx exists at the documented path", () => {
    expect(existsSync(sharedPath)).toBe(true);
  });

  test("shared module exports ChevronDownIcon", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ChevronDownIcon\b/);
  });

  test("shared module exports ShieldIcon", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ShieldIcon\b/);
  });

  test("shared module exports ClipboardListIcon", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ClipboardListIcon\b/);
  });

  test("shared module exports PenLineIcon", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+function\s+PenLineIcon\b/);
  });

  test("shared module exports LockOpenIcon", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+function\s+LockOpenIcon\b/);
  });

  test("shared module exports ModeIconProps type", () => {
    const src = readFileSync(sharedPath, "utf8");
    expect(src).toMatch(/export\s+type\s+ModeIconProps\b/);
  });

  test("PermissionLevelPill imports chevron from the shared module", () => {
    const src = readFileSync(permissionPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/composer-pill-icons["']/);
    expect(src).not.toContain(CHEVRON_PATH_LITERAL);
  });

  test("ModelSelectorPill imports chevron from the shared module", () => {
    const src = readFileSync(modelSelectorPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/composer-pill-icons["']/);
    expect(src).not.toContain(CHEVRON_PATH_LITERAL);
  });

  test("ModelSettingsPill imports chevron from the shared module", () => {
    const src = readFileSync(modelSettingsPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/composer-pill-icons["']/);
    expect(src).not.toContain(CHEVRON_PATH_LITERAL);
  });

  test("ChatComposer no longer declares the icon functions", () => {
    const src = readFileSync(chatComposerPath, "utf8");
    expect(src).not.toMatch(/function\s+ShieldIcon\b/);
    expect(src).not.toMatch(/function\s+ClipboardListIcon\b/);
    expect(src).not.toMatch(/function\s+PenLineIcon\b/);
    expect(src).not.toMatch(/function\s+LockOpenIcon\b/);
  });

  test("PermissionLevelPill no longer declares private ShieldIcon / PenLineIcon / LockOpenIcon", () => {
    const src = readFileSync(permissionPath, "utf8");
    expect(src).not.toMatch(/function\s+ShieldIcon\b/);
    expect(src).not.toMatch(/function\s+PenLineIcon\b/);
    expect(src).not.toMatch(/function\s+LockOpenIcon\b/);
  });

  test("chevron SVG path literal appears only in the shared module", () => {
    const sharedHits = readFileSync(sharedPath, "utf8").split(CHEVRON_PATH_LITERAL).length - 1;
    expect(sharedHits).toBeGreaterThanOrEqual(1);
    for (const path of [permissionPath, modelSelectorPath, modelSettingsPath, chatComposerPath]) {
      expect(readFileSync(path, "utf8")).not.toContain(CHEVRON_PATH_LITERAL);
    }
  });

});
