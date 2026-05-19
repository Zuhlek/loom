/**
 * T-014 — Context-usage indicator (circular SVG ring + warning state).
 *
 * Verifies (US-005 AC1/AC2/AC3/AC4):
 *   AC1: `ContextUsageIndicator.tsx` exists, exports a
 *        `ContextUsageIndicator` React component, accepts a single
 *        `usage: ContextUsageSnapshot | null` prop.
 *   AC2: The component renders a circular SVG: an `<svg>` with a
 *        `<circle>` that drives the arc via `stroke-dasharray` /
 *        `stroke-dashoffset` so the filled arc reflects `percentage`.
 *   AC3: A percentage label is rendered inside the ring; NULL `usage`
 *        renders `0%` (US-005 AC4).
 *   AC4: Warning treatment fires at `percentage >= 90` — the source
 *        carries the `>= 90` threshold and `var(--destructive)` stroke.
 *   AC5: A `title` attribute (hover tooltip) surfaces `totalTokens /
 *        maxTokens` and `model`.
 *   AC6: `useChatBridge` exposes a `contextUsage: ContextUsageSnapshot |
 *        null` field, handles the `context-usage-update` frame, and
 *        `reset()` clears the cached snapshot.
 *   AC7: `ChatComposer.tsx` imports `ContextUsageIndicator` and mounts
 *        it in the `contextUsage` slot of `ComposerFooterToolbar`,
 *        replacing the T-009 placeholder stub. A `contextUsage` prop is
 *        threaded through to receive the bridge snapshot.
 *   AC8: `live-chat.tsx` threads `bridge.contextUsage` into the
 *        `ChatComposer` prop.
 *
 * RED path:
 *   Before implementation, `ContextUsageIndicator.tsx` does not exist —
 *   the existence assertion fails at runtime (NOT compile time, per the
 *   project's red-phase contract).
 *
 * Test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component files,
 * matching the project convention established by
 * `composer-footer-toolbar.test.ts` and `model-selector-pill.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const indicatorPath = webRoot + "src/components/chat/ContextUsageIndicator.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const bridgePath = webRoot + "src/lib/use-chat-bridge.ts";
const routePath = webRoot + "src/routes/live-chat.tsx";

describe("T-014 ContextUsageIndicator — circular SVG ring", () => {
  test("ContextUsageIndicator.tsx exists at the documented path", () => {
    expect(existsSync(indicatorPath)).toBe(true);
  });

  test("declares a `ContextUsageIndicator` React component", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ContextUsageIndicator\b/);
  });

  test("accepts a `usage` prop typed as `ContextUsageSnapshot | null`", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/\busage\s*\??\s*:/);
    expect(src).toMatch(/ContextUsageSnapshot\s*\|\s*null/);
  });

  test("renders an SVG circle driven by stroke-dasharray + stroke-dashoffset", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/<svg\b/);
    expect(src).toMatch(/<circle\b/);
    expect(src).toMatch(/strokeDasharray|stroke-dasharray/);
    expect(src).toMatch(/strokeDashoffset|stroke-dashoffset/);
  });

  test("renders a percentage label inside the ring; NULL → 0% (US-005 AC4)", () => {
    const src = readFileSync(indicatorPath, "utf8");
    // The component must compute a `${n}%` string and handle the
    // null-usage fallback. Either an inline ternary or an early-zero
    // computation satisfies the contract.
    expect(src).toMatch(/%/);
    // Explicit zero-fallback when usage is null.
    expect(src).toMatch(/usage\s*\?\s*[^:]*:\s*0|usage\s*===\s*null|usage\s*==\s*null|\?\?\s*0/);
  });

  test("warning treatment fires at `percentage >= 90` with destructive stroke", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/>=\s*90/);
    expect(src).toMatch(/var\(--destructive\)/);
  });

  test("exposes a tooltip via the `title` attribute surfacing tokens + model", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/title\s*=/);
    expect(src).toMatch(/totalTokens/);
    expect(src).toMatch(/maxTokens/);
    expect(src).toMatch(/model/);
  });

  test("carries a testid so the parent / tests can locate the indicator", () => {
    const src = readFileSync(indicatorPath, "utf8");
    expect(src).toMatch(/data-testid\s*=\s*["']composer-pill-context-usage["']/);
  });
});

describe("T-014 useChatBridge — handles context-usage-update frame", () => {
  test("exposes a `contextUsage` field on the bridge return type", () => {
    const src = readFileSync(bridgePath, "utf8");
    expect(src).toMatch(/\bcontextUsage\s*:/);
  });

  test("handles the `context-usage-update` frame kind", () => {
    const src = readFileSync(bridgePath, "utf8");
    expect(src).toMatch(/["']context-usage-update["']/);
  });

  test("`reset()` clears the cached snapshot to null", () => {
    const src = readFileSync(bridgePath, "utf8");
    // Both setters must be called in reset — same pattern as slashCommands.
    expect(src).toMatch(/setContextUsage\s*\(\s*null\s*\)/);
  });

  test("defines or imports a `ContextUsageSnapshot` type", () => {
    const src = readFileSync(bridgePath, "utf8");
    expect(src).toMatch(/ContextUsageSnapshot/);
  });
});

describe("T-014 ChatComposer — mounts ContextUsageIndicator", () => {
  test("ChatComposer imports ContextUsageIndicator", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*ContextUsageIndicator\s*\}\s*from\s*["']\.\/ContextUsageIndicator["']/,
    );
  });

  test("ChatComposer mounts <ContextUsageIndicator … /> in the contextUsage slot", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ContextUsageIndicator\b/);
    expect(src).toMatch(/contextUsage\s*=\s*\{\s*<ContextUsageIndicator\b/);
  });

  test("ChatComposerProps grew a `contextUsage` prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/contextUsage\s*\??\s*:/);
  });

  test("the T-009 placeholder stub for context-usage is gone", () => {
    const src = readFileSync(composerPath, "utf8");
    // The stub was `<div data-testid="composer-pill-context-usage" />`.
    // Once the real component mounts the bare stub must not remain.
    expect(src).not.toMatch(
      /<div\s+data-testid=["']composer-pill-context-usage["']\s*\/>/,
    );
  });
});

describe("T-014 live-chat route — threads bridge.contextUsage through", () => {
  test("live-chat passes `contextUsage={bridge.contextUsage}` to ChatComposer", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/contextUsage\s*=\s*\{\s*bridge\.contextUsage\s*\}/);
  });
});
