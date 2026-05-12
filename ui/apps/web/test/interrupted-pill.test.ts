/**
 * T-005 — Interrupted state pill + implicit resume surface (web side).
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (T-002, T-004, T-008): vitest's include glob is
 * `apps/** /test/** /*.test.ts` only and the test runtime is `node`
 * (no jsdom). We verify the ChatComposer source declares a visible,
 * accessible "Interrupted" pill when `isInterrupted` is true; that
 * the pill is absent when `isInterrupted` is false (gated by the
 * existing prop); and that `live-chat.tsx` derives `isInterrupted`
 * from `turnState === "interrupted"` and passes it through.
 *
 * What we assert (US-005 AC1–AC3):
 *
 *   AC1 (composer): when `isInterrupted` is true, the ChatComposer
 *       renders a pill adjacent to the Stop/Send control with the
 *       visible label "Interrupted". The render is conditional on
 *       the `isInterrupted` prop (so when the prop is false the pill
 *       is absent — verified by locating the conditional in source).
 *
 *   AC1 (visible-distinct): the pill carries a non-muted warning
 *       color (amber / warning theme) — the task brief calls out
 *       `bg-amber-700` / `text-amber-100` or whichever theme token
 *       the loom UI uses for non-error warnings. We assert one of
 *       the warning-color markers is present so the pill is not a
 *       placeholder muted span.
 *
 *   AC1 (a11y): the pill exposes an ARIA semantic — either
 *       `role="status"` (so screen readers announce the interrupted
 *       state on transition) or an `aria-label` carrying the
 *       resume-affordance copy. We accept either shape and require
 *       the tooltip / aria-label / title to mention "Send a message
 *       to continue" so the user understands the implicit re-prime
 *       path without a visible button.
 *
 *   AC2 (composer enabled): the composer remains enabled when
 *       `turnState === "interrupted"` — this is verified at the
 *       `composerDisabled` / `composerMode` derivation site in
 *       `live-chat.tsx`. The Design `## composerDisabled policy
 *       split` places `"interrupted"` in the `"ready"` bucket. We
 *       assert the source DOES NOT treat `"interrupted"` as a
 *       blocking state in the disabled derivation (no
 *       `turnState === "interrupted"` literal inside the
 *       composerDisabled / composerMode `"blocked"` branch).
 *
 *   AC3 (live verification rolled into T-011): no static check; the
 *       end-to-end smoke flow lives in the smoke task. This file
 *       only asserts the UI contract.
 *
 *   live-chat: the route already passes `isInterrupted={state.turnState ===
 *       "interrupted"}` (landed by T-004 as a stub). We re-verify the
 *       derivation lives at the composer mount site so reducer drift
 *       can't silently break the pill.
 *
 * RED path:
 *   Before this task the ChatComposer renders a placeholder muted
 *   `<span>` for the pill with no ARIA semantic and no resume
 *   tooltip (per T-004.done.md: "the pill is intentionally minimal
 *   (T-005 owns the full UX)"). The warning-color, role/aria-label,
 *   and resume-affordance copy assertions all fail until T-005 lands
 *   the real pill.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";

/**
 * Locate the JSX `<span>` (or `<div>`) element carrying
 * `data-testid="interrupted-pill"` in the composer source and return
 * its full opening-tag-through-closing-tag substring. Returns `null`
 * if the element is missing.
 *
 * Why we don't just slice 400 chars forward from `data-testid`:
 * the Stop button sits immediately after the pill in source order
 * with its own `style={{ background: "var(--destructive)" }}` and
 * `title="Interrupt the running turn"`. A naive forward-slice
 * captures both elements and pollutes the warning-color /
 * resume-copy assertions with the sibling button's attributes.
 */
function extractPillSpan(src: string): string | null {
  const testIdRe = /data-testid=["']interrupted-pill["']/;
  const testIdMatch = testIdRe.exec(src);
  if (!testIdMatch) return null;
  const testIdIdx = testIdMatch.index;
  // Walk backwards from the test-id to the nearest `<span` or `<div`
  // opener. The element kind is whichever shows up first.
  const before = src.slice(0, testIdIdx);
  const openerRe = /<(span|div)\b[^>]*$/;
  let elementName: "span" | "div" | null = null;
  let openerStart = -1;
  // Walk backwards line-by-line until we hit an unterminated opener.
  // Simpler: regex-search for the last `<span\b` or `<div\b` before
  // the test-id index that is not already closed.
  const spanOpens = [...before.matchAll(/<(span|div)\b/g)].map((m) => ({
    idx: m.index!,
    name: m[1] as "span" | "div",
  }));
  if (spanOpens.length === 0) return null;
  const lastOpener = spanOpens[spanOpens.length - 1];
  openerStart = lastOpener.idx;
  elementName = lastOpener.name;
  // Closing tag must be after the test-id.
  const closeRe = new RegExp(`</${elementName}>`);
  const afterTestId = src.slice(testIdIdx);
  const closeMatch = closeRe.exec(afterTestId);
  if (!closeMatch) return null;
  const closeEnd = testIdIdx + closeMatch.index + closeMatch[0].length;
  return src.slice(openerStart, closeEnd);
}

describe("T-005 ChatComposer — Interrupted pill renders when isInterrupted (US-005 AC1)", () => {
  test("ChatComposer accepts an `isInterrupted` prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/isInterrupted\s*[:?]/);
  });

  test("the pill render is conditional on `isInterrupted` (absent when prop is false)", () => {
    const src = readFileSync(composerPath, "utf8");
    // The pill JSX hangs off a conditional guarded by isInterrupted.
    // Accept either `{isInterrupted && (...)}` or
    // `{isInterrupted ? <...> : null}`.
    const hasGuard =
      /\{\s*isInterrupted\s*&&\s*[(<]/.test(src) ||
      /\{\s*isInterrupted\s*\?\s*</.test(src);
    expect(hasGuard).toBe(true);
  });

  test("the pill carries the visible label 'Interrupted'", () => {
    const src = readFileSync(composerPath, "utf8");
    // The label is rendered as literal text inside the pill JSX.
    expect(src).toMatch(/>\s*Interrupted\s*</);
  });

  test("the pill carries a non-muted warning color (amber / warning theme)", () => {
    const src = readFileSync(composerPath, "utf8");
    // Locate the pill element span by extracting the span that
    // contains `data-testid="interrupted-pill"` — slice from the
    // nearest preceding `<span` opener through the closing
    // `</span>` so we don't pick up sibling elements (the Stop
    // button immediately follows the pill in source order).
    const pill = extractPillSpan(src);
    expect(pill).toBeTruthy();
    const hasWarningColor =
      /amber/.test(pill!) ||
      /warning/i.test(pill!) ||
      /\bdestructive\b/.test(pill!) ||
      /--warning/.test(pill!);
    expect(hasWarningColor).toBe(true);
    // Negative: the pill is NOT the placeholder muted-only span.
    // Specifically the pill must not source both background AND
    // color from `var(--muted)` / `var(--muted-foreground)` with
    // no warning-color override.
    const placeholderMuted =
      /background:\s*["']var\(--muted\)["'][\s,][^}]*color:\s*["']var\(--muted-foreground\)["']/.test(
        pill!,
      );
    expect(placeholderMuted).toBe(false);
  });

  test("the pill exposes ARIA semantics (role=status or aria-label)", () => {
    const src = readFileSync(composerPath, "utf8");
    const pill = extractPillSpan(src);
    expect(pill).toBeTruthy();
    // Either a `role="status"` (live-region announcement on state
    // transition) or an `aria-label="..."` — both are valid.
    const hasAria =
      /role=["']status["']/.test(pill!) ||
      /aria-label=["'][^"']+["']/.test(pill!);
    expect(hasAria).toBe(true);
  });

  test("the pill explains the implicit-resume affordance (tooltip / aria-label / title mentions sending a message)", () => {
    const src = readFileSync(composerPath, "utf8");
    const pill = extractPillSpan(src);
    expect(pill).toBeTruthy();
    // The affordance copy lives in one of: `title=`, `aria-label=`,
    // or as visible text adjacent to the pill. The task brief
    // suggests "Send a message to continue from where Claude paused."
    // We accept any wording that conveys the "send a message to
    // continue" intent — match the verb "continue" or "resume"
    // alongside "message" / "send".
    const hasResumeCopy =
      /(?:title|aria-label)=["'][^"']*(?:continue|resume)[^"']*["']/i.test(pill!) ||
      /(?:Send|send)[^"']*(?:message|reply)[^"']*(?:continue|resume)/i.test(pill!);
    expect(hasResumeCopy).toBe(true);
  });
});

describe("T-005 ChatComposer — pill placement (adjacent to Stop/Send)", () => {
  test("the pill JSX sits adjacent to the Stop/Send button block", () => {
    const src = readFileSync(composerPath, "utf8");
    // The pill must render close to the Stop/Send block — the task
    // brief asks for "next to the Stop/Send button or in the composer
    // footer". Anchoring loosely: the pill data-testid must occur
    // before the Send button's `title="Send (Enter)"` marker AND
    // after the composer's top-level `<div`. (Order matters for the
    // visual flex layout; the pill should precede the Send button
    // so it reads left-of-control.)
    const pillIdx = src.indexOf('data-testid="interrupted-pill"');
    const sendIdx = src.indexOf('title="Send (Enter)"');
    expect(pillIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(0);
    expect(pillIdx).toBeLessThan(sendIdx);
  });
});

describe("T-005 live-chat — isInterrupted derivation from turnState (US-005 AC2)", () => {
  test("live-chat passes `isInterrupted={state.turnState === \"interrupted\"}` to the composer", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(
      /isInterrupted\s*=\s*\{\s*state\.turnState\s*===\s*["']interrupted["']\s*\}/,
    );
  });

  test('composer is NOT hard-disabled when turnState === "interrupted" (interrupted falls in the "ready" bucket per Design)', () => {
    const src = readFileSync(liveChatPath, "utf8");
    // The composerDisabled / composerMode derivation must not list
    // `"interrupted"` as a blocking state. We scan the file for the
    // disabled / blocked derivation and assert no `=== "interrupted"`
    // comparison appears inside a `composerDisabled` / `blocked`
    // assignment.
    //
    // Loose check: if the file contains `composerDisabled = ...` or
    // a `composerMode` derivation, ensure neither line equates
    // `turnState === "interrupted"` with a disabled/blocked state.
    const disabledLines = src
      .split(/\n/)
      .filter((line) => /composer(?:Disabled|Mode|Reason)/i.test(line));
    for (const line of disabledLines) {
      // The line may MENTION "interrupted" only in the negative
      // (e.g. a comment); a code expression like
      // `turnState === "interrupted"` inside a disabled-truthiness
      // computation is the forbidden shape.
      if (/turnState\s*===\s*["']interrupted["']/.test(line)) {
        // Allow the composer-mount-site line that passes
        // `isInterrupted={state.turnState === "interrupted"}` —
        // that's the pill wiring, not the disabled derivation.
        if (/isInterrupted\s*=/.test(line)) continue;
        throw new Error(
          `composerDisabled / composerMode treats "interrupted" as blocking: ${line.trim()}`,
        );
      }
    }
    // Sanity: the file must contain SOME composer-disabled
    // derivation (so the assertion above isn't vacuous).
    expect(disabledLines.length).toBeGreaterThan(0);
  });
});
