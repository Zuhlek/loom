/**
 * T-008 — Sticky error banner (web side).
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (T-002, T-004, T-006): vitest's include glob is
 * `apps/** /test/** /*.test.ts` only and the test runtime is `node`
 * (no jsdom). We verify the reducer source declares the new
 * `error: { message: string; dismissed: boolean } | null` shape,
 * the snapshot action preserves it, the dismiss action sets
 * `dismissed: true`, and the live-chat route renders the
 * `ChatErrorBanner` conditional on `!dismissed`.
 *
 * What we assert (US-008 AC1–AC4):
 *
 *   AC1 (web): `live-chat.tsx` declares the sticky-error shape on the
 *       reducer's state: `error: { message: string; dismissed: boolean } | null`
 *       (replacing the old `lastError: string | undefined`). On
 *       `turn-state` / `error` server frames the reducer SETs
 *       `error = { message, dismissed: false }`.
 *
 *   AC2 (web): the `snapshot` reducer branch does NOT clear `state.error`
 *       — it only overwrites when the snapshot carries a NEW message
 *       (`body.lastError && body.lastError !== state.error?.message`).
 *
 *   AC3 (web): a `dismiss-error` reducer action sets `state.error.dismissed = true`.
 *       The banner JSX renders iff `state.error && !state.error.dismissed`.
 *       A dismiss button (× / aria-label) wires the action.
 *
 *   AC4 (web): on a fresh error after dismiss, the reducer overwrites
 *       with `{ message, dismissed: false }` — i.e. the new-error
 *       branch does NOT preserve `dismissed` when the message changes.
 *
 *   ChatErrorBanner: a dedicated component file exists with `message`
 *       + `onDismiss` props per the Design state machine. (May be
 *       inline; if so, the live-chat source must carry an equivalent
 *       dismiss handler + close-button render.)
 *
 * RED path:
 *   Before implementation, `live-chat.tsx` carries `lastError: string | undefined`
 *   and the `snapshot` branch unconditionally overwrites `lastError`
 *   from `body.lastError` (clobbering on every snapshot). There is no
 *   `dismiss-error` action, no `error.dismissed` shape, no banner
 *   dismiss button, and no `ChatErrorBanner` component. The static
 *   regexes return false; runtime assertions fail.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const bannerPath = webRoot + "src/components/chat/ChatErrorBanner.tsx";

describe("T-008 reducer error shape (US-008 AC1)", () => {
  test("live-chat declares the sticky error shape on ChatState", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The reducer field is `error: { message: string; dismissed: boolean } | null`.
    // Loose match: the reducer state must declare an `error` field with
    // both `message` and `dismissed` somewhere in the source.
    expect(src).toMatch(/error\s*:\s*\{[^}]*message[^}]*dismissed[^}]*\}/);
  });

  test("live-chat does NOT carry the old `lastError: string` reducer field", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The old shape was `lastError: string | undefined` on ChatState.
    // The new shape uses `error.message`; the old field name must be gone
    // from the ChatState/EMPTY_STATE block. (We accept transient
    // `body.lastError` access on incoming frames — that's the wire field,
    // not the reducer field.)
    expect(src).not.toMatch(/\bChatState\b[\s\S]{0,400}lastError\s*:/);
    expect(src).not.toMatch(/EMPTY_STATE[\s\S]{0,400}lastError\s*:/);
  });

  test("reducer's `turn-state` branch sets `error: { message, dismissed: false }` when an error message arrives", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The turn-state action carries `lastError?: string`. When present,
    // the reducer must construct `{ message: ..., dismissed: false }`.
    expect(src).toMatch(/dismissed\s*:\s*false/);
  });
});

describe("T-008 reducer snapshot preserves error (US-008 AC2)", () => {
  test("snapshot branch does NOT unconditionally clear or overwrite the error field", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // Locate the snapshot branch and verify it does NOT contain a bare
    // `lastError: action.payload.body.lastError` assignment (the old
    // clobbering shape). The replacement either preserves
    // `state.error` or only overwrites on a novel message.
    const snapshotBranchMatch = src.match(/case\s+"snapshot":[\s\S]*?case\s+"/);
    expect(snapshotBranchMatch).toBeTruthy();
    const branch = snapshotBranchMatch![0];
    // Must NOT reassign error from body.lastError unconditionally.
    expect(branch).not.toMatch(/^\s*lastError:\s*action\.payload\.body\.lastError\s*,?\s*$/m);
    // Must either (a) reference `state.error` (preserve path) or
    // (b) compare `body.lastError` to `state.error?.message` (novel path).
    const preservesError =
      /state\.error/.test(branch) ||
      /state\.error\?\.message/.test(branch);
    expect(preservesError).toBe(true);
  });
});

describe("T-008 dismiss action + banner conditional render (US-008 AC3)", () => {
  test("a `dismiss-error` reducer action exists and sets `dismissed: true`", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // Action discriminant: `type: "dismiss-error"` (or `error-dismiss`).
    expect(src).toMatch(/["'](?:dismiss-error|error-dismiss)["']/);
    // Reducer branch sets `dismissed: true`.
    expect(src).toMatch(/dismissed\s*:\s*true/);
  });

  test("banner JSX renders conditional on `!state.error.dismissed`", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The banner conditional combines truthy `error` with `!error.dismissed`.
    // Accept either `state.error && !state.error.dismissed` or the
    // negated equivalent.
    const hasGuard =
      /state\.error\s*&&\s*!state\.error\.dismissed/.test(src) ||
      /!state\.error\.dismissed\s*&&\s*state\.error/.test(src);
    expect(hasGuard).toBe(true);
  });

  test("banner exposes a dismiss control (× / aria-label / close button)", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The dismiss action must be dispatched on click somewhere in the
    // banner render path. We accept either an inline button onClick
    // that dispatches the action, or a ChatErrorBanner component with
    // an `onDismiss` prop.
    const dispatchesDismiss =
      /dispatch\(\s*\{\s*type:\s*["'](?:dismiss-error|error-dismiss)["']/.test(src) ||
      /onDismiss\s*=/.test(src);
    expect(dispatchesDismiss).toBe(true);
    // Visible affordance: × character, aria-label "Dismiss", or text "Dismiss".
    const hasAffordance =
      /["']×["']/.test(src) ||
      /aria-label=["']Dismiss/i.test(src) ||
      /<ChatErrorBanner\b/.test(src);
    expect(hasAffordance).toBe(true);
  });
});

describe("T-008 re-show on new error after dismiss (US-008 AC4)", () => {
  test("turn-state / error branches reset `dismissed: false` when message changes", () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The reducer must not preserve `dismissed: true` when a NEW error
    // (different message) arrives. The cleanest way to verify
    // statically: the `dismissed: false` literal appears at least once
    // inside a turn-state or item-append/error handler (i.e. somewhere
    // outside the snapshot branch). We already asserted the literal
    // exists; this test pins it to the right branch.
    const turnStateBranchMatch = src.match(/case\s+"turn-state":[\s\S]*?(?=case\s+"|}\s*\})/);
    expect(turnStateBranchMatch).toBeTruthy();
    const branch = turnStateBranchMatch![0];
    // The branch sets error with `dismissed: false` when a lastError
    // is present.
    expect(branch).toMatch(/dismissed\s*:\s*false/);
  });
});

describe("T-008 ChatErrorBanner component or inline equivalent", () => {
  test("either a ChatErrorBanner.tsx component file exists, or live-chat renders the banner inline with the dismiss wiring", () => {
    if (existsSync(bannerPath)) {
      const src = readFileSync(bannerPath, "utf8");
      // The component declares `message` + `onDismiss` per the task brief.
      expect(src).toMatch(/message\s*[:?]\s*string/);
      expect(src).toMatch(/onDismiss/);
    } else {
      // Inline-banner shape: live-chat itself must carry the JSX with
      // a dismiss button that fires the dismiss action.
      const src = readFileSync(liveChatPath, "utf8");
      expect(src).toMatch(/dispatch\(\s*\{\s*type:\s*["'](?:dismiss-error|error-dismiss)["']/);
    }
  });
});
