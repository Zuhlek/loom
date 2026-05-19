/**
 * T-011 — Model settings pill: combined reasoning + context-window popup,
 * persists on pick.
 *
 * Verifies (US-008 AC1/4/5, US-009 AC3):
 *   AC1: `ModelSettingsPill.tsx` exists, exports a `ModelSettingsPill`
 *        React component, and accepts the `value` / `onPick` / `disabled`
 *        prop trio.
 *   AC2: The pill source carries the six reasoning labels — Low / Medium
 *        / High / Extra High / Max / Ultrathink — paired with their SDK
 *        effort identifiers (`low`/`medium`/`high`/`xhigh`/`max`) per
 *        the design `Pill → WireModelSettings` translation table.
 *   AC3: The pill source carries the two context-window labels (`200k`,
 *        `1M`) paired with the wire values (`200k`, `1m`).
 *   AC4: Ultrathink maps to `{ effort: 'max', thinking: { type:
 *        'enabled', budgetTokens: 32000 } }` per ADR-D07.
 *   AC5: NULL value falls back to the default labels (Extra High · 200k)
 *        per US-008 AC5.
 *   AC6: Pick emits a partial-patch via `onPick` (US-008 AC1).
 *   AC7: Popover closes on Escape + outside-click — same pattern as
 *        `PermissionLevelPill` (T-013 prior art).
 *   AC8: The pill is NOT disabled by `isRunning` — only the parent's
 *        `disabled` prop hard-disables it (US-009 AC3 — mid-flight
 *        clicks must still emit; in-flight Query options are NOT the
 *        source of truth for the label).
 *   AC9: `ChatComposer.tsx` imports `ModelSettingsPill` and mounts it
 *        in the `modelSettings` slot of `ComposerFooterToolbar`,
 *        replacing the T-009 placeholder stub.
 *
 * RED path:
 *   Before implementation, `ModelSettingsPill.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per
 *   the project's red-phase contract).
 *
 * Test runtime is `node` (see `ui/vitest.config.ts`), so assertions are
 * static-source string-grep against the component files, matching the
 * project convention established by `permission-level-pill.test.ts` and
 * `model-selector-pill.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/ModelSettingsPill.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

// The six reasoning rows the pill MUST render — UI label paired with the
// SDK effort identifier the pick emits. Ultrathink is the overflow case
// — its effort is `max` and it also sets the `thinking` block.
const REASONING_ROWS = [
  { label: "Low", effort: "low" },
  { label: "Medium", effort: "medium" },
  { label: "High", effort: "high" },
  { label: "Extra High", effort: "xhigh" },
  { label: "Max", effort: "max" },
  { label: "Ultrathink", effort: "max" },
] as const;

// The two context-window rows.
const CONTEXT_ROWS = [
  { label: "200k", value: "200k" },
  { label: "1M", value: "1m" },
] as const;

describe("T-011 ModelSettingsPill — reasoning + context-window popup", () => {
  test("ModelSettingsPill.tsx exists at the documented path", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("declares a `ModelSettingsPill` React component", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ModelSettingsPill\b/);
  });

  test("accepts `value` + `onPick` + `disabled` props", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/\bvalue\s*:/);
    expect(src).toMatch(/\bonPick\s*:/);
    expect(src).toMatch(/\bdisabled\s*\??\s*:/);
  });

  test("carries the six reasoning labels (Low / Medium / High / Extra High / Max / Ultrathink)", () => {
    const src = readFileSync(pillPath, "utf8");
    for (const row of REASONING_ROWS) {
      expect(src, `pill must show the label '${row.label}'`).toContain(row.label);
    }
  });

  test("carries the five SDK effort identifiers (low/medium/high/xhigh/max)", () => {
    const src = readFileSync(pillPath, "utf8");
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(src, `pill must carry the SDK effort '${effort}'`).toMatch(
        new RegExp(`["']${effort}["']`),
      );
    }
  });

  test("carries the two context-window rows (200k / 1M paired with 200k / 1m)", () => {
    const src = readFileSync(pillPath, "utf8");
    for (const row of CONTEXT_ROWS) {
      expect(src, `pill must show the label '${row.label}'`).toContain(row.label);
      expect(src, `pill must carry the wire value '${row.value}'`).toMatch(
        new RegExp(`["']${row.value}["']`),
      );
    }
  });

  test("Ultrathink maps to thinking.budgetTokens === 32000 (ADR-D07)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/budgetTokens\s*:\s*32000/);
    expect(src).toMatch(/type\s*:\s*["']enabled["']/);
  });

  test("NULL value falls back to the default labels (Extra High · 200k)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toContain("Extra High");
    expect(src).toContain("200k");
  });

  test("invokes `onPick` when a row is picked", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/onPick\s*\(/);
  });

  test("closes on Escape + outside click (popover pattern parity)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/["']Escape["']/);
    expect(src).toMatch(/mousedown|pointerdown/);
  });

  test("popup floats above the pill (bottom-full popover positioning)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/bottom-full/);
    expect(src).toMatch(/absolute/);
  });

  test("uses radio inputs (or role=radio) for the two groups per design", () => {
    const src = readFileSync(pillPath, "utf8");
    // Two radio groups: reasoning (six rows) + context window (two rows).
    expect(src).toMatch(/type\s*=\s*["']radio["']|role\s*=\s*["']radio["']/);
  });

  test("does NOT read `isRunning` / queue state — pill stays clickable mid-flight (US-009 AC3)", () => {
    const src = readFileSync(pillPath, "utf8");
    // The pill must not branch on a running-turn flag. Only the parent's
    // `disabled` boolean dictates hard-disable. The string `isRunning`
    // must not appear in the component source — it's not a prop and the
    // pill must not consult parent state through some side channel.
    expect(src).not.toMatch(/\bisRunning\b/);
    expect(src).not.toMatch(/\bcomposerMode\b/);
  });
});

describe("T-011 ChatComposer — mounts ModelSettingsPill", () => {
  test("ChatComposer imports ModelSettingsPill", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*ModelSettingsPill\s*\}\s*from\s*["']\.\/ModelSettingsPill["']/,
    );
  });

  test("ChatComposer mounts <ModelSettingsPill … /> in the modelSettings slot", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ModelSettingsPill\b/);
    expect(src).toMatch(/modelSettings\s*=\s*\{\s*<ModelSettingsPill\b/);
  });

  test("the T-009 placeholder stub for model-settings is gone", () => {
    const src = readFileSync(composerPath, "utf8");
    // The stub was `<div data-testid="composer-pill-model-settings" />`.
    // After T-011 the testid lives on the pill wrapper (or its trigger),
    // not on an empty placeholder div.
    expect(src).not.toMatch(
      /<div\s+data-testid=["']composer-pill-model-settings["']\s*\/>/,
    );
  });

  test("ChatComposer wires `onModelSettingsSet` into the pill (US-008 AC1)", () => {
    const src = readFileSync(composerPath, "utf8");
    // The pill's onPick prop must forward into onModelSettingsSet — the
    // partial-patch emitter T-010 established.
    expect(src).toMatch(
      /<ModelSettingsPill[\s\S]*?onPick\s*=\s*\{[\s\S]*?onModelSettingsSet/,
    );
  });
});
