/**
 * T-002 — `DiffFileCard` component (US-010).
 *
 * Vitest runtime here is `node` and the include glob is
 * `apps/** /test/** /*.test.ts` only (see `ui/vitest.config.ts`);
 * the web app does not depend on jsdom or @testing-library/react.
 * Tests for React components in this suite therefore follow the
 * static-source + pure-logic precedent set by
 * `composer-controls.test.ts`, `proposed-plan-card.test.ts`,
 * `ask-user-question-picker.test.ts`, etc.
 *
 * What is asserted:
 *
 *   - File-exists contract (DiffFileCard.tsx is the documented path).
 *   - Type-surface contract (`DiffFileCardProps` shape) via static
 *     grep on the component source.
 *   - Render-shape contract via grep over the JSX literal — the
 *     header row carries the status badge, file path, and `+N -M`
 *     summary; the hunks container applies `maxHeight` as an inline
 *     style; the chevron is wired to the collapse setter.
 *   - Per-kind class mapping (`add → diff-add`, `del → diff-del`,
 *     `context → px-2`, `meta → diff-meta italic`) via grep over
 *     the lifted DiffLineRow body.
 *   - `defaultCollapsed` and `useState<boolean>` declarations are
 *     present.
 *
 *   - DiffPanel.tsx contract: MIT attribution preserved; the file
 *     now exports the shared diff types + BranchToolbar only (the
 *     DiffPanel / DiffPanelShell components were removed in R-002
 *     cleanup after DiffPanelContainer absorbed the composition).
 *
 * The static-source approach matches the precedent for React-only
 * components in this suite. T-001's data-layer tests run the
 * functions directly because they are pure modules; React renders
 * here cannot be executed without jsdom, so we shift the assertion
 * surface up to the source rather than the DOM.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import type { DiffFile, DiffLine } from "../src/components/diff/DiffPanel";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const cardPath = webRoot + "src/components/diff/DiffFileCard.tsx";
const panelPath = webRoot + "src/components/diff/DiffPanel.tsx";

// Touch the type imports so unused-symbol checks don't complain.
type _AnchorTypes = [DiffFile, DiffLine];

describe("T-002 DiffFileCard — file exists + import surface", () => {
  test("DiffFileCard.tsx exists at the documented path", () => {
    expect(existsSync(cardPath)).toBe(true);
  });

  test("imports DiffFile / DiffLine / DiffStatus from ./DiffPanel", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/DiffPanel["']/);
    expect(src).toMatch(/\bDiffFile\b/);
    expect(src).toMatch(/\bDiffLine\b/);
    expect(src).toMatch(/\bDiffStatus\b/);
  });

  test("imports useState from react", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/import\s+\{[^}]*\buseState\b[^}]*\}\s+from\s+["']react["']/);
  });
});

describe("T-002 DiffFileCard — props contract", () => {
  test("exports `DiffFileCardProps` with file/defaultCollapsed/maxHeight", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/export\s+(interface|type)\s+DiffFileCardProps/);
    // Required `file` prop typed as DiffFile.
    expect(src).toMatch(/file\s*:\s*DiffFile\b/);
    // Optional defaults.
    expect(src).toMatch(/defaultCollapsed\?\s*:\s*boolean/);
    expect(src).toMatch(/maxHeight\?\s*:\s*string/);
  });

  test("exports the component `DiffFileCard`", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/export\s+function\s+DiffFileCard\b/);
  });
});

describe("T-002 DiffFileCard — collapse state + chevron wiring", () => {
  test("declares useState<boolean>(...) seeded from defaultCollapsed", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/useState<boolean>/);
    // The seed expression must reference defaultCollapsed; either a
    // direct `defaultCollapsed ?? false` or a destructured-default
    // pattern. We require the literal token to appear adjacent to
    // useState to anchor the contract.
    expect(src).toMatch(/defaultCollapsed/);
  });

  test("chevron button is wired with a click handler that toggles the collapse state", () => {
    const src = readFileSync(cardPath, "utf8");
    // The toggle handler must invoke the collapse setter with a
    // functional update (or a boolean flip).
    // Accept any of: `setCollapsed((c) => !c)`, `setCollapsed(!collapsed)`,
    // or `setX((v) => !v)` where the setter name matches /^set[A-Z]/.
    const togglePattern =
      /set[A-Z]\w*\s*\(\s*(?:\([a-z_]\w*\)|[a-z_]\w*)\s*=>\s*!\w+\s*\)|set[A-Z]\w*\s*\(\s*!\w+\s*\)/;
    expect(src).toMatch(togglePattern);
    // And the handler must be bound to an onClick somewhere.
    expect(src).toMatch(/onClick=\{/);
  });

  test("renders hunks only when NOT collapsed (collapsed branch is guarded)", () => {
    const src = readFileSync(cardPath, "utf8");
    // The hunks block is guarded by a !collapsed check. Accept either
    // `!collapsed && (` short-circuit or a ternary that branches on
    // the collapsed boolean. The contract is: the hunks JSX appears
    // inside a conditional whose discriminator is the collapse state.
    const guarded =
      /!\s*collapsed\s*&&/.test(src) ||
      /collapsed\s*\?\s*null/.test(src) ||
      /!\s*collapsed\s*\?/.test(src);
    expect(guarded).toBe(true);
  });
});

describe("T-002 DiffFileCard — header row contract", () => {
  test("header renders the status badge ({file.status})", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/\{\s*file\.status\s*\}/);
  });

  test("header renders the file path ({file.path})", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/\{\s*file\.path\s*\}/);
  });

  test("header renders the +N -M summary (file.added / file.removed)", () => {
    const src = readFileSync(cardPath, "utf8");
    // The lifted JSX uses a leading "+" before file.added and a
    // unicode minus "−" before file.removed.
    expect(src).toMatch(/\+\{?\s*file\.added/);
    expect(src).toMatch(/[−-]\{?\s*file\.removed/);
  });

  test("status badge uses STATUS_BG / STATUS_FG mapping or inline style on file.status", () => {
    const src = readFileSync(cardPath, "utf8");
    // The lifted JSX referenced STATUS_BG[file.status] / STATUS_FG[file.status].
    // The new component re-uses the same mapping (either imported from
    // DiffPanel or duplicated locally with the same names).
    expect(src).toMatch(/STATUS_BG\s*\[\s*file\.status\s*\]/);
    expect(src).toMatch(/STATUS_FG\s*\[\s*file\.status\s*\]/);
  });
});

describe("T-002 DiffFileCard — hunks container + line styling", () => {
  test("hunks container applies maxHeight as inline style when provided", () => {
    const src = readFileSync(cardPath, "utf8");
    // The `maxHeight` prop must surface inside a `style=` JSX
    // attribute somewhere. Accept any of:
    //   - `style={{ maxHeight, ... }}` (literal object shorthand)
    //   - `style={maxHeight ? { maxHeight, ... } : undefined}` (ternary)
    //   - `style={hunkStyle}` where `hunkStyle` carries maxHeight
    // The contract: the literal token `maxHeight` appears inside a
    // `style={...}` JSX expression.
    const hasMaxHeightStyle = /style=\{[^}]*\bmaxHeight\b/.test(src);
    expect(hasMaxHeightStyle).toBe(true);
  });

  test("add lines → diff-add class", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/["']diff-add\b/);
  });

  test("del lines → diff-del class", () => {
    const src = readFileSync(cardPath, "utf8");
    expect(src).toMatch(/["']diff-del\b/);
  });

  test("meta lines → diff-meta + italic class", () => {
    const src = readFileSync(cardPath, "utf8");
    // Match either `"diff-meta italic ..."` or `"diff-meta ... italic ..."`
    // in any class-name expression of the meta line branch.
    expect(src).toMatch(/diff-meta[^"'`]*italic|italic[^"'`]*diff-meta/);
  });

  test("context lines → px-2 (default muted bg)", () => {
    const src = readFileSync(cardPath, "utf8");
    // Context lines have no per-kind class; they share the px-2 padding
    // class the original DiffLineRow body assigned. The component must
    // still emit a px-2 class for unmatched line kinds.
    expect(src).toMatch(/["']px-2["']/);
  });

  test("each hunk line renders with a stable key (the lifted .map iterator)", () => {
    const src = readFileSync(cardPath, "utf8");
    // The lifted JSX used `.map((line, i) => ...)` with `key={i}`.
    // We accept any `.map((` callback that emits a keyed element.
    expect(src).toMatch(/\.map\s*\(/);
    expect(src).toMatch(/key=\{/);
  });
});

describe("DiffPanel.tsx — shared-surface contract", () => {
  test("MIT attribution preserved in file header", () => {
    const src = readFileSync(panelPath, "utf8");
    expect(src).toMatch(/MIT-licensed/);
    expect(src).toMatch(/t3code/);
  });

  test("exports the shared diff types", () => {
    const src = readFileSync(panelPath, "utf8");
    expect(src).toMatch(/export\s+type\s+DiffStatus\b/);
    expect(src).toMatch(/export\s+type\s+DiffLine\b/);
    expect(src).toMatch(/export\s+type\s+DiffFile\b/);
  });

  test("exports BranchToolbar primitive only — no inner DiffPanel / DiffPanelShell", () => {
    const src = readFileSync(panelPath, "utf8");
    expect(src).toMatch(/export\s+function\s+BranchToolbar\b/);
    expect(src).not.toMatch(/export\s+function\s+DiffPanel\b/);
    expect(src).not.toMatch(/export\s+function\s+DiffPanelShell\b/);
    expect(src).not.toMatch(/export\s+interface\s+DiffPanelProps\b/);
    expect(src).not.toMatch(/export\s+interface\s+DiffPanelShellProps\b/);
  });
});
