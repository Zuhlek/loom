/**
 * T-010 — Model selector pill: dropdown of Claude models, persists on pick.
 *
 * Verifies (US-003 AC1, US-007 AC1/2/4/5):
 *   AC1: `ModelSelectorPill.tsx` exists, exports a `ModelSelectorPill`
 *        React component, and accepts the `value` / `onPick` /
 *        `disabled` / `open` / `onOpenChange` prop quartet per the
 *        design.
 *   AC2: The pill source carries a client-side constant list of
 *        supported Claude models (Opus 4.7 / 4.6 / 4.5, Sonnet 4.6,
 *        Haiku 4.5) keyed on the SDK identifiers (`claude-opus-4-7`,
 *        `claude-opus-4-6`, `claude-opus-4-5`, `claude-sonnet-4-6`,
 *        `claude-haiku-4-5`) per the seed-clarifications guidance.
 *   AC3: NULL `value` renders the SDK-default label (US-007 AC5) — the
 *        source carries the "Claude (default)" string.
 *   AC4: The pill does NOT carry the out-of-scope affordances per
 *        spec §Out of scope: no search input, no favorite-star icon,
 *        no hotkey chip.
 *   AC5: The dropdown closes on outside-click + Escape — same popover
 *        pattern as `PermissionLevelPill` (US-003 AC1 "dropdown
 *        anchored to the pill").
 *   AC6: `ChatComposer.tsx` imports `ModelSelectorPill` and mounts it
 *        in the `modelSelector` slot of `ComposerFooterToolbar`,
 *        replacing the T-009 placeholder stub. The `/model` built-in
 *        accept branch opens the picker (`setModelPickerOpen(true)`).
 *   AC7: `ChatComposerProps` grew `modelSettings` (current row state)
 *        and `onModelSettingsSet` (partial-patch emitter) props. The
 *        pick handler calls `onModelSettingsSet({ model: '<id>' })`
 *        (US-007 AC1 — partial frame body).
 *
 * RED path:
 *   Before implementation, `ModelSelectorPill.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per
 *   the project's red-phase contract).
 *
 * Test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component
 * files, matching the project convention established by
 * `permission-level-pill.test.ts` and `composer-builtin-dispatch.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/ModelSelectorPill.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

// Seed-clarifications: dropdown carries Claude models only. The five
// rows the pill MUST surface — Anthropic-convention identifiers paired
// with their user-facing labels.
const MODELS = [
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-opus-4-5", label: "Opus 4.5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;

describe("T-010 ModelSelectorPill — Claude-only dropdown", () => {
  test("ModelSelectorPill.tsx exists at the documented path", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("declares a `ModelSelectorPill` React component", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ModelSelectorPill\b/);
  });

  test("accepts `value` + `onPick` + `open` + `onOpenChange` props", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/\bvalue\s*:/);
    expect(src).toMatch(/\bonPick\s*:/);
    expect(src).toMatch(/\bopen\s*\??\s*:/);
    expect(src).toMatch(/\bonOpenChange\s*\??\s*:/);
  });

  test("carries the five supported Claude models (ids + labels)", () => {
    const src = readFileSync(pillPath, "utf8");
    for (const m of MODELS) {
      expect(src, `pill must carry the SDK id '${m.id}'`).toMatch(
        new RegExp(`["']${m.id}["']`),
      );
      expect(src, `pill must show the label '${m.label}'`).toContain(m.label);
    }
  });

  test("renders the SDK-default label when value is NULL (US-007 AC5)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toContain("Claude (default)");
  });

  test("invokes `onPick` when a row is picked", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/onPick\s*\(/);
  });

  test("does NOT include out-of-scope affordances (search input, favorite, hotkey)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).not.toMatch(/<input\b[^>]*type\s*=\s*["']?(text|search)["']?/i);
    expect(src).not.toMatch(/\bfavorite\b/i);
    expect(src).not.toMatch(/\bhotkey\b/i);
    expect(src).not.toMatch(/\bstar\b/i);
  });

  test("closes on Escape + outside click (popover pattern parity)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/["']Escape["']/);
    expect(src).toMatch(/mousedown|pointerdown/);
  });

  test("dropdown floats above the pill (bottom-full popover positioning)", () => {
    const src = readFileSync(pillPath, "utf8");
    // Matches the PermissionLevelPill convention: absolute bottom-full.
    expect(src).toMatch(/bottom-full/);
    expect(src).toMatch(/absolute/);
  });

  test("dropdown is keyed as a listbox + active row gets aria-selected", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/role\s*=\s*["']listbox["']/);
    expect(src).toMatch(/aria-selected\s*=/);
  });
});

describe("T-010 ChatComposer — mounts ModelSelectorPill", () => {
  test("ChatComposer imports ModelSelectorPill", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*ModelSelectorPill\s*\}\s*from\s*["']\.\/ModelSelectorPill["']/,
    );
  });

  test("ChatComposer mounts <ModelSelectorPill … /> in the modelSelector slot", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ModelSelectorPill\b/);
    expect(src).toMatch(/modelSelector\s*=\s*\{\s*<ModelSelectorPill\b/);
  });

  test("ChatComposerProps grew a `modelSettings` prop (WireModelSettings | null)", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/modelSettings\s*\??\s*:/);
  });

  test("ChatComposerProps grew an `onModelSettingsSet` partial-patch prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onModelSettingsSet\s*\??\s*:/);
  });

  test("ChatComposer holds local modelPickerOpen state", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/setModelPickerOpen\s*\(/);
  });

  test("/model accept branch opens the picker (setModelPickerOpen(true))", () => {
    const src = readFileSync(composerPath, "utf8");
    // The /model built-in branch must drive the local picker open.
    expect(src).toMatch(/setModelPickerOpen\(\s*true\s*\)/);
  });

  test("pick handler emits a partial `{ model }` patch via onModelSettingsSet (US-007 AC1)", () => {
    const src = readFileSync(composerPath, "utf8");
    // Match either an inline arrow or a named handler that forwards
    // the chosen model id through the partial-patch prop.
    expect(src).toMatch(/onModelSettingsSet\??\.?\(\s*\{[^}]*model\s*:/);
  });
});
