/**
 * T-012 — Build/Plan toggle pill (single-click flip).
 *
 * Verifies (US-004 AC1/AC2/AC3/AC4 + ADR-D06):
 *   AC1: `BuildPlanTogglePill.tsx` exists, exports a
 *        `BuildPlanTogglePill` React component, and mounts in the
 *        `buildPlanToggle` slot of {@link ComposerFooterToolbar} via
 *        `ChatComposer.tsx` (between `ModelSettingsPill` and
 *        `PermissionLevelPill` per the T-009 slot order).
 *   AC2: From `mode !== 'plan'` the pill renders the label `Build` and
 *        clicking flips through `onModeChange('plan')`.
 *   AC3: From `mode === 'plan'` the pill renders the label `Plan` and
 *        clicking flips through `onModeChange(lastNonPlanMode)` —
 *        defaults to `'default'` when the prop is omitted at the call
 *        site (in practice the parent always seeds the ref via
 *        `useRef('default')`).
 *   AC4: `PermissionLevelPill.tsx` does not carry the `plan` row in its
 *        rendered popup options (T-013 already dropped it — this assert
 *        keeps the two controls aligned per ADR-D06).
 *
 * RED path:
 *   Before implementation, `BuildPlanTogglePill.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per the
 *   project's red-phase contract).
 *
 * Runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component files,
 * matching the convention used by `permission-level-pill.test.ts` and
 * `composer-footer-toolbar.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/BuildPlanTogglePill.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const permissionLevelPath = webRoot + "src/components/chat/PermissionLevelPill.tsx";

describe("T-012 BuildPlanTogglePill — single-click toggle", () => {
  test("BuildPlanTogglePill.tsx exists at the documented path", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("declares a `BuildPlanTogglePill` React component", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+BuildPlanTogglePill\b/);
  });

  test("accepts `mode`, `onModeChange`, and `lastNonPlanMode` props", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/\bmode\s*\??\s*:/);
    expect(src).toMatch(/\bonModeChange\s*\??\s*:/);
    expect(src).toMatch(/\blastNonPlanMode\s*\??\s*:/);
  });

  test("renders the label `Build` when mode !== 'plan' (US-004 AC2)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toContain("Build");
  });

  test("renders the label `Plan` when mode === 'plan' (US-004 AC3)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toContain("Plan");
  });

  test("click handler flips to `plan` from a non-plan mode (US-004 AC2)", () => {
    const src = readFileSync(pillPath, "utf8");
    // The Build → Plan branch must invoke onModeChange with the string
    // literal 'plan'. We grep for that call shape directly.
    expect(src).toMatch(/onModeChange\(\s*["']plan["']\s*\)/);
  });

  test("click handler flips back via `lastNonPlanMode` (US-004 AC3)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/onModeChange\(\s*lastNonPlanMode\s*\)/);
  });

  test("is a single button, not a dropdown (no popup-listbox markup)", () => {
    const src = readFileSync(pillPath, "utf8");
    // The pill is a two-state pill per the seed-clarifications visual
    // contract: no role="listbox", no aria-haspopup, no `open` state.
    expect(src).not.toMatch(/role\s*=\s*["']listbox["']/);
    expect(src).not.toMatch(/aria-haspopup/);
    // A single <button> element drives both states.
    expect(src).toMatch(/<button\b/);
  });
});

describe("T-012 ChatComposer — wires the BuildPlanTogglePill", () => {
  test("ChatComposer imports BuildPlanTogglePill", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*BuildPlanTogglePill\s*\}\s*from\s*["']\.\/BuildPlanTogglePill["']/,
    );
  });

  test("ChatComposer mounts <BuildPlanTogglePill … /> in the buildPlanToggle slot (US-004 AC1)", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<BuildPlanTogglePill\b/);
    expect(src).toMatch(/buildPlanToggle\s*=\s*\{\s*<BuildPlanTogglePill\b/);
  });

  test("ChatComposer holds a `lastNonPlanModeRef` for the toggle pill", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/lastNonPlanModeRef/);
  });
});

describe("T-012 PermissionLevelPill — `plan` row stays out of the popup (US-004 AC4)", () => {
  test("PermissionLevelPill popup does NOT render a `plan` row", () => {
    const src = readFileSync(permissionLevelPath, "utf8");
    expect(src).not.toMatch(/value\s*:\s*["']plan["']/);
  });
});
