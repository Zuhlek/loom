/**
 * T-009 — `ComposerFooterToolbar` container + send-button regrouping.
 *
 * Verifies:
 *   AC1: `ComposerFooterToolbar.tsx` exists, is a pure layout container,
 *        and renders five named slot children + a send button in the
 *        documented left-to-right order:
 *          ModelSelectorPill · ModelSettingsPill · BuildPlanTogglePill ·
 *          PermissionLevelPill · <spacer> · ContextUsageIndicator ·
 *          send button.
 *   AC2: Container has NO internal state and NO fetch / WS calls —
 *        no `useState` / `useEffect` / `fetch(` / `WebSocket` /
 *        `useReducer` imports or call sites.
 *   AC3: `ChatComposer.tsx` mounts the new container in place of the
 *        prior footer JSX with placeholder `<div>` stubs for the five
 *        pills (T-010..T-014 land the real pills later).
 *
 * The test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component files,
 * matching the project convention established by `composer-controls.test.ts`.
 *
 * RED path:
 *   Before implementation, `ComposerFooterToolbar.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per the
 *   project's red-phase contract).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const toolbarPath = webRoot + "src/components/chat/ComposerFooterToolbar.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

// Five named slots, left-to-right, plus the send button. Order matters.
const SLOT_NAMES = [
  "modelSelector",
  "modelSettings",
  "buildPlanToggle",
  "permissionLevel",
  "contextUsage",
] as const;

describe("T-009 ComposerFooterToolbar — pure layout container", () => {
  test("ComposerFooterToolbar.tsx exists at the documented path", () => {
    expect(existsSync(toolbarPath)).toBe(true);
  });

  test("declares a `ComposerFooterToolbar` React component", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ComposerFooterToolbar\b/);
  });

  test("accepts five named slot props + a send button slot", () => {
    const src = readFileSync(toolbarPath, "utf8");
    for (const slot of SLOT_NAMES) {
      // Each slot appears as a prop name (`modelSelector:` / `modelSelector?:`).
      const re = new RegExp(`\\b${slot}\\s*\\??\\s*:`);
      expect(src).toMatch(re);
    }
    expect(src).toMatch(/\bsendButton\s*\??\s*:/);
  });

  test("renders the five slots in the documented left-to-right order", () => {
    const src = readFileSync(toolbarPath, "utf8");
    // Each slot is interpolated as `{props.<name>}` (or destructured
    // `{<name>}`) in the JSX. We assert each reference exists and that
    // the JSX-position order matches `SLOT_NAMES` ++ `sendButton`.
    const order = [...SLOT_NAMES, "sendButton"] as const;
    const positions = order.map((slot) => {
      // Match the JSX interpolation `{<slot>}` (or `{ <slot> }`).
      const re = new RegExp(`\\{\\s*${slot}\\s*\\}`);
      const match = src.match(re);
      expect(match, `slot ${slot} must be interpolated as {${slot}} in JSX`).not.toBeNull();
      return src.indexOf(match![0]);
    });
    // Strict monotonic increase — first occurrence of each slot in JSX
    // appears in `order`.
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `slot ${order[i]} must appear AFTER ${order[i - 1]} in the JSX`,
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("send button is the rightmost child (after the context-usage slot)", () => {
    const src = readFileSync(toolbarPath, "utf8");
    const usageIdx = src.indexOf("{contextUsage}");
    const sendIdx = src.indexOf("{sendButton}");
    expect(usageIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(usageIdx);
  });

  test("contains no internal state — no useState / useReducer / useEffect", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).not.toMatch(/\buseState\b/);
    expect(src).not.toMatch(/\buseReducer\b/);
    expect(src).not.toMatch(/\buseEffect\b/);
  });

  test("contains no fetch or WebSocket calls", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bWebSocket\b/);
  });
});

describe("T-009 ChatComposer — mounts ComposerFooterToolbar with placeholder pills", () => {
  test("ChatComposer imports ComposerFooterToolbar", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/import\s*\{\s*ComposerFooterToolbar\s*\}\s*from\s*["']\.\/ComposerFooterToolbar["']/);
  });

  test("ChatComposer renders <ComposerFooterToolbar … /> in place of the prior footer JSX", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ComposerFooterToolbar\b/);
  });

  test("ChatComposer passes the five placeholder pill slots to the toolbar", () => {
    const src = readFileSync(composerPath, "utf8");
    // Each slot is wired as a JSX prop on `<ComposerFooterToolbar>`.
    for (const slot of SLOT_NAMES) {
      const re = new RegExp(`${slot}=\\{`);
      expect(src, `ChatComposer must pass ${slot} to ComposerFooterToolbar`).toMatch(re);
    }
    expect(src).toMatch(/sendButton=\{/);
  });

  test("each slot is wired — either as a placeholder stub or as the real T-010..T-014 pill component", () => {
    const src = readFileSync(composerPath, "utf8");
    // Stubs are inline `<div>`s tagged with a data-testid; the real pill
    // component (e.g. `<PermissionLevelPill ... />`) replaces the stub once
    // its owning task lands. Either form satisfies the slot-wired contract.
    const SLOTS: ReadonlyArray<{ testId: string; component: string }> = [
      { testId: "composer-pill-model-selector", component: "ModelSelectorPill" },
      { testId: "composer-pill-model-settings", component: "ModelSettingsPill" },
      { testId: "composer-pill-build-plan", component: "BuildPlanTogglePill" },
      { testId: "composer-pill-permission-level", component: "PermissionLevelPill" },
      { testId: "composer-pill-context-usage", component: "ContextUsageIndicator" },
    ];
    for (const { testId, component } of SLOTS) {
      const stubRe = new RegExp(`data-testid=["']${testId}["']`);
      const realRe = new RegExp(`<${component}\\b`);
      const wired = stubRe.test(src) || realRe.test(src);
      expect(
        wired,
        `ChatComposer must wire the ${testId} slot — either as a stub with that testId or as a <${component}> mount`,
      ).toBe(true);
    }
  });
});
