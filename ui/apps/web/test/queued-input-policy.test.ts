/**
 * T-007 — Queued input while running (composer-mode policy split).
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (see chat-markdown-shiki.test.ts, composer-controls.test.ts,
 * interrupted-pill.test.ts) — vitest's include glob is
 * `apps/**\/test/**\/*.test.ts` only and the runtime is `node` (no
 * jsdom). We verify the composer-mode derivation logic exposed by
 * `live-chat.tsx`, the composer's three-mode rendering contract, and
 * the wire-priority defaulting on submit.
 *
 * What we assert (US-007 AC1–AC4 / Design `## composerDisabled
 * policy split`):
 *
 *   AC4 (state-model): `live-chat.tsx` exports a pure `composerMode`
 *       selector returning the three Design states
 *       `"ready" | "queue" | "blocked"` (or, equivalent: declares the
 *       same type alias and uses it at the composer mount site). The
 *       selector is pure and depends only on the fields the test
 *       supplies (`pendingPermission`, `pendingQuestion`, `turnState`).
 *
 *   AC4 (selector behaviour): calling `composerMode(state)` returns
 *       - `"blocked"` when `pendingPermission` is non-null;
 *       - `"blocked"` when `pendingQuestion` is non-null;
 *       - `"queue"` when `turnState === "running"` AND neither
 *         pending field is set;
 *       - `"ready"` otherwise (including `"idle"`, `"interrupted"`,
 *         `"error"`).
 *
 *   AC1 / AC3 (composer rendering split): `ChatComposer.tsx` accepts
 *       a `composerMode` prop typed to the three states and uses it
 *       to drive hard-disable behaviour. The hard-disable path
 *       (textarea + send button disabled) gates on
 *       `composerMode === "blocked"` rather than the legacy boolean
 *       `disabled`. In `"queue"` mode the textarea remains enabled.
 *
 *   AC2 (priority default): when the user submits a turn while the
 *       composer is in `"queue"` mode the outgoing frame carries
 *       `priority: "next"` by default. In `"ready"` mode the
 *       priority defaults to `"now"` (the field may be omitted on
 *       the wire — that's the legacy byte-compatible shape).
 *
 *   live-chat wiring: the route imports / re-exports `composerMode`,
 *       passes the selector result through to the composer prop, and
 *       the submit handler reads the composer's `queuePriority` arg
 *       (already wired by T-004). In `"queue"` mode the parent
 *       supplies `queuePriority="next"` as the default; in `"ready"`
 *       mode the parent supplies `queuePriority="now"`.
 *
 * RED path (pre-implementation):
 *   - The `composerMode` selector symbol is not exported from
 *     `live-chat.tsx`, so the dynamic-import in the runtime tests
 *     yields `undefined` and the assertion fails at runtime (NOT a
 *     compile error — we use `await import(...)` so missing exports
 *     surface as a runtime `expect(...).toBe(...)` mismatch).
 *   - The static-source tests fail because the file does not yet
 *     contain the `ComposerMode` type, the `composerMode` selector
 *     definition, the `"queue"` literal, or the `priority === "next"`
 *     defaulting branch.
 *   - The ChatComposer source does not yet accept a `composerMode`
 *     prop nor branch its disabled behaviour on the three-state
 *     value, so the corresponding regex assertions fail.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

describe("T-007 live-chat — composerMode selector exists and is pure (US-007 AC4)", () => {
  test("live-chat.tsx exists", () => {
    expect(existsSync(liveChatPath)).toBe(true);
  });

  test("live-chat declares the three-state `ComposerMode` type with literal values", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The type alias spells out the three discriminants. Order is
    // not load-bearing; we match each literal independently.
    expect(src).toMatch(/ComposerMode/);
    expect(src).toMatch(/["']ready["']/);
    expect(src).toMatch(/["']queue["']/);
    expect(src).toMatch(/["']blocked["']/);
  });

  test("live-chat exports a `composerMode` selector (named export)", async () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The function declaration / export site must be present so the
    // runtime import below resolves to a function. The selector
    // pattern is `export function composerMode(` per the task brief
    // — but accept any shape that exports the symbol.
    const hasExport =
      /export\s+function\s+composerMode\b/.test(src) ||
      /export\s+const\s+composerMode\s*[:=]/.test(src) ||
      /export\s*\{[^}]*\bcomposerMode\b[^}]*\}/.test(src);
    expect(hasExport).toBe(true);
  });
});

describe("T-007 composerMode selector — runtime behaviour (US-007 AC1–AC4)", () => {
  /**
   * Dynamic-import the route module so we get the real selector. The
   * route file imports React + wouter + the WS client; we don't
   * invoke `LiveChatRoute()` itself — only the pure `composerMode`
   * helper. The route module loads in Node because it's all type +
   * function decls; React hooks aren't called at import time.
   *
   * Returns the selector or throws a descriptive assertion if the
   * export is missing — the dynamic-import fallback keeps the red
   * phase failure visible at the assertion site rather than at the
   * module-load site.
   */
  async function loadSelector(): Promise<
    (state: SelectorState) => "ready" | "queue" | "blocked"
  > {
    const mod = (await import("../src/routes/live-chat")) as Record<
      string,
      unknown
    >;
    const fn = mod.composerMode;
    if (typeof fn !== "function") {
      throw new Error(
        "live-chat.tsx must export a `composerMode` selector function",
      );
    }
    return fn as (state: SelectorState) => "ready" | "queue" | "blocked";
  }

  interface SelectorState {
    pendingPermission: unknown;
    pendingQuestion: unknown;
    turnState: "idle" | "running" | "interrupted" | "error";
  }

  const READY_STATES: Array<SelectorState["turnState"]> = [
    "idle",
    "interrupted",
    "error",
  ];

  test('returns "blocked" when pendingPermission is set', async () => {
    const composerMode = await loadSelector();
    const state: SelectorState = {
      pendingPermission: { id: "p1", toolName: "Read", input: {} },
      pendingQuestion: null,
      turnState: "running",
    };
    expect(composerMode(state)).toBe("blocked");
  });

  test('returns "blocked" when pendingQuestion is set (even with no permission)', async () => {
    const composerMode = await loadSelector();
    const state: SelectorState = {
      pendingPermission: null,
      pendingQuestion: { id: "q1", question: "pick", options: [] },
      turnState: "running",
    };
    expect(composerMode(state)).toBe("blocked");
  });

  test('returns "blocked" when both pending fields are set', async () => {
    const composerMode = await loadSelector();
    const state: SelectorState = {
      pendingPermission: { id: "p1", toolName: "Read", input: {} },
      pendingQuestion: { id: "q1", question: "pick", options: [] },
      turnState: "running",
    };
    expect(composerMode(state)).toBe("blocked");
  });

  test('returns "queue" when turnState === "running" and no blockers', async () => {
    const composerMode = await loadSelector();
    const state: SelectorState = {
      pendingPermission: null,
      pendingQuestion: null,
      turnState: "running",
    };
    expect(composerMode(state)).toBe("queue");
  });

  test('returns "ready" for idle / interrupted / error when no blockers', async () => {
    const composerMode = await loadSelector();
    for (const ts of READY_STATES) {
      const state: SelectorState = {
        pendingPermission: null,
        pendingQuestion: null,
        turnState: ts,
      };
      expect(composerMode(state)).toBe("ready");
    }
  });

  test('"blocked" takes precedence over "queue" — pending fields beat turnState === "running"', async () => {
    const composerMode = await loadSelector();
    // Sanity ordering check: a pending permission while running must
    // surface as "blocked", not "queue".
    const state: SelectorState = {
      pendingPermission: { id: "p1", toolName: "Read", input: {} },
      pendingQuestion: null,
      turnState: "running",
    };
    expect(composerMode(state)).toBe("blocked");
  });

  test("selector is pure — same input yields same output across calls", async () => {
    const composerMode = await loadSelector();
    const state: SelectorState = {
      pendingPermission: null,
      pendingQuestion: null,
      turnState: "running",
    };
    expect(composerMode(state)).toBe("queue");
    expect(composerMode(state)).toBe("queue");
  });
});

describe("T-007 ChatComposer — three-mode rendering contract (US-007 AC1/AC3)", () => {
  test("ChatComposer accepts a `composerMode` prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/composerMode\s*[:?]/);
  });

  test("ChatComposer references all three mode literals", () => {
    const src = readFileSync(composerPath, "utf8");
    // The component should compare against each of the three modes
    // somewhere — either an explicit `=== "blocked"` or a switch /
    // map keyed on the values.
    expect(src).toMatch(/["']ready["']/);
    expect(src).toMatch(/["']queue["']/);
    expect(src).toMatch(/["']blocked["']/);
  });

  test('ChatComposer hard-disables on `composerMode === "blocked"`', () => {
    const src = readFileSync(composerPath, "utf8");
    // The blocked branch must drive a disabled flag. Accept either a
    // direct `composerMode === "blocked"` comparison or a derived
    // boolean (e.g. `isBlocked = composerMode === "blocked"`).
    const hasBlockedDerivation =
      /composerMode\s*===\s*["']blocked["']/.test(src);
    expect(hasBlockedDerivation).toBe(true);
  });

  test('Send button affordance changes when `composerMode === "queue"` (label / title says "Queue")', () => {
    const src = readFileSync(composerPath, "utf8");
    // The queue-mode send button surfaces visibly as "Queue" — either
    // in visible text, the title attribute, or the aria-label. We
    // accept any of those.
    const hasQueueLabel =
      />\s*Queue\s*</.test(src) ||
      /title=["']Queue[^"']*["']/.test(src) ||
      /aria-label=["']Queue[^"']*["']/.test(src);
    expect(hasQueueLabel).toBe(true);
  });
});

describe("T-007 live-chat — composer wiring (US-007 AC2)", () => {
  test("live-chat passes `composerMode={composerMode(state)}` (or equivalent) to the composer", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The mount site supplies the composerMode prop sourced from the
    // selector — match either the inline call or a variable that
    // captures the selector output.
    const hasMountWiring =
      /composerMode\s*=\s*\{\s*composerMode\s*\(/.test(src) ||
      /composerMode\s*=\s*\{[^}]*\bmode\b[^}]*\}/.test(src) ||
      /composerMode\s*=\s*\{[^}]*\}/.test(src);
    expect(hasMountWiring).toBe(true);
  });

  // The queue-priority defaulting tests that previously lived here have
  // been removed alongside the priority-toggle UI. The composer no
  // longer emits a `priority` field on user-turn frames — every submit
  // relies on the server's default placement. The wire shape stays
  // backward-compatible (server still accepts an optional `priority`).
});
