/**
 * T-013 — Permission level pill extracted from ChatComposer.
 *
 * Verifies (US-004 AC4 + task acceptance criteria):
 *   AC1: `PermissionLevelPill.tsx` exists, exports a `PermissionLevelPill`
 *        React component, and accepts a `mode` + `onChange` prop pair
 *        (the route forwards `onChange` to a `permission-mode-set`
 *        frame — handled by `live-chat.tsx`, unchanged).
 *   AC2: The pill renders three permission-mode rows with the t3code-
 *        aligned labels — `Supervised` / `Auto-accept edits` /
 *        `Full access` — keyed on the SDK values `default` /
 *        `acceptEdits` / `bypassPermissions`.
 *   AC3: The pill source does NOT contain a `"plan"` row literal in
 *        the rendered option list (US-004 AC4 — the `plan` mode value
 *        itself stays on the wire, driven by the Build/Plan toggle pill
 *        in T-012, but it is not pickable from this control).
 *   AC4: `ChatComposer.tsx` imports `PermissionLevelPill` and mounts it
 *        in the `permissionLevel` slot of `ComposerFooterToolbar`,
 *        replacing the T-009 placeholder stub. The stranded
 *        `PERMISSION_MODES` constant + the `onPermissionSelectChange`
 *        handler no longer live in `ChatComposer.tsx`.
 *
 * RED path:
 *   Before implementation, `PermissionLevelPill.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per the
 *   project's red-phase contract).
 *
 * Test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component files,
 * matching the project convention established by
 * `composer-footer-toolbar.test.ts` and `composer-controls.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/PermissionLevelPill.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

// The three SDK PermissionMode values the rendered row list MUST cover,
// paired with the t3code-aligned label the pill MUST show for each.
const ROWS = [
  { value: "default", label: "Supervised" },
  { value: "acceptEdits", label: "Auto-accept edits" },
  { value: "bypassPermissions", label: "Full access" },
] as const;

describe("T-013 PermissionLevelPill — extracted from ChatComposer", () => {
  test("PermissionLevelPill.tsx exists at the documented path", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("declares a `PermissionLevelPill` React component", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+PermissionLevelPill\b/);
  });

  test("accepts a `mode` + `onChange` prop pair", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/\bmode\s*\??\s*:/);
    expect(src).toMatch(/\bonChange\s*\??\s*:/);
  });

  test("renders three rows with the t3code-aligned labels", () => {
    const src = readFileSync(pillPath, "utf8");
    for (const row of ROWS) {
      expect(src, `pill must carry the SDK value '${row.value}'`).toMatch(
        new RegExp(`["']${row.value}["']`),
      );
      expect(src, `pill must show the label '${row.label}'`).toContain(row.label);
    }
  });

  test("does NOT include a `plan` row in the rendered option list (US-004 AC4)", () => {
    const src = readFileSync(pillPath, "utf8");
    // The `plan` literal must not appear as an option `value` in the
    // pill's row catalog. We assert no `value: "plan"` / `value: 'plan'`
    // tuple is present.
    expect(src).not.toMatch(/value\s*:\s*["']plan["']/);
  });

  test("invokes `onChange` when a row is picked (parity with prior `onPermissionModeChange`)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/onChange\s*\(/);
  });
});

describe("T-013 ChatComposer — mounts the new PermissionLevelPill", () => {
  test("ChatComposer imports PermissionLevelPill", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*PermissionLevelPill\s*\}\s*from\s*["']\.\/PermissionLevelPill["']/,
    );
  });

  test("ChatComposer renders <PermissionLevelPill … /> in the permissionLevel slot", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<PermissionLevelPill\b/);
    // Wired into the toolbar slot, not orphaned somewhere else in the
    // tree — the substring `permissionLevel={<PermissionLevelPill`
    // (whitespace-tolerant) anchors the placement.
    expect(src).toMatch(/permissionLevel\s*=\s*\{\s*<PermissionLevelPill\b/);
  });

  test("ChatComposer no longer holds the `PERMISSION_MODES` constant (lives in the pill now)", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).not.toMatch(/\bPERMISSION_MODES\b/);
  });

  test("ChatComposer no longer holds the `onPermissionSelectChange` handler", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).not.toMatch(/\bonPermissionSelectChange\b/);
  });
});
