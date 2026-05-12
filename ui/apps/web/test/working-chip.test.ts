/**
 * T-003 — WorkingChip sibling row + activeTurnStartedAt reducer field.
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (T-002, T-004, T-005, T-008): vitest's include glob is
 * `apps/** /test/** /*.test.ts` only and the test runtime is `node`
 * (no jsdom). We verify the WorkingChip component file exists and
 * declares the expected shape, MessagesTimeline renders the chip as
 * the LAST child of the scroll container gated on
 * `turnState === "running" && activeTurnStartedAt != null`, and the
 * live-chat.tsx reducer manages `activeTurnStartedAt` correctly.
 *
 * What we assert (US-003 AC1-AC5):
 *
 *   AC1 / AC4 / AC5 (chip is a sibling row, one per turn): MessagesTimeline
 *     renders `<WorkingChip ... />` BELOW the items.map loop, inside the
 *     scroll container. The conditional render is gated on
 *     `turnState === "running"` AND `activeTurnStartedAt` truthy.
 *     A single chip per turn is enforced by sourcing
 *     `activeTurnStartedAt` from the reducer (not per-message state)
 *     — the reducer only sets it once on idle->running and clears on
 *     transition out.
 *
 *   AC2 (live elapsed counter, 1s tick): WorkingChip uses
 *     `setInterval(..., 1000)` and the displayed label uses
 *     "Working for {Xs|Xm Ys|Xh Ym}" via formatElapsed mirroring
 *     t3code's formatWorkingTimer.
 *
 *   AC3 (removed on transition out): The conditional render gate
 *     ensures the chip unmounts when `turnState` leaves `running`.
 *     The reducer clears `activeTurnStartedAt` on every non-running
 *     turn-state transition.
 *
 *   Reducer correctness (ADR-005): `activeTurnStartedAt` is added to
 *     ChatState; turn-state action sets to Date.now() on idle->running,
 *     preserves on running->running, clears on running->idle/error/
 *     interrupted; snapshot reseeds based on the incoming turnState.
 *
 *   Inline "Thinking..." placeholder removed: per the task brief, the
 *     existing inline `blocks.length === 0 && streaming` "Thinking..."
 *     fallback at the AssistantRow site is removed in favour of the
 *     single chip-per-turn UX (overrides design.md's plan-time note;
 *     recorded in done.md as an explicit deviation from T-003.md item 5).
 *
 * RED path:
 *   Before this task lands, `ui/apps/web/src/components/chat/WorkingChip.tsx`
 *   does NOT exist (existsSync false). MessagesTimeline.tsx carries the
 *   inline `Working...` block at :82-90 instead of importing/rendering
 *   `<WorkingChip>`. live-chat.tsx's ChatState has no
 *   `activeTurnStartedAt` field. The static regexes return false; runtime
 *   assertions fail.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const chipPath = webRoot + "src/components/chat/WorkingChip.tsx";
const timelinePath = webRoot + "src/components/chat/MessagesTimeline.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";

/**
 * Extract the body of a `case "<name>":` reducer branch by brace
 * balancing — handles nested `{ ... }` literals (e.g. the snapshot
 * branch's nested object construction). Returns `null` when the case
 * is not present. The match is delimited by the next `case ` or
 * `default:` keyword AT THE SAME INDENT LEVEL, located after the
 * outermost brace closes.
 */
function extractCaseBranch(src: string, caseName: string): string | null {
  const re = new RegExp(`case\\s+"${caseName}":`);
  const m = re.exec(src);
  if (!m) return null;
  const startIdx = m.index;
  // Walk forward, counting braces from the opening `{` after the
  // colon. When the count returns to 0 we've reached the branch's
  // closing brace.
  const tail = src.slice(startIdx);
  const openIdx = tail.indexOf("{");
  if (openIdx === -1) {
    // Single-statement branch (no block) — fall back to slicing until
    // the next `case ` or `default:`.
    const stopRe = /\bcase\s+"|\bdefault\s*:/g;
    stopRe.lastIndex = m[0].length;
    const stop = stopRe.exec(tail);
    return stop ? tail.slice(0, stop.index) : tail;
  }
  let depth = 0;
  let i = openIdx;
  for (; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return tail.slice(0, i);
}

describe("T-003 WorkingChip component file (US-003 AC1, AC2, AC5)", () => {
  test("WorkingChip.tsx exists at the expected path", () => {
    expect(existsSync(chipPath)).toBe(true);
  });

  test("WorkingChip is exported as a named component", () => {
    const src = readFileSync(chipPath, "utf8");
    expect(src).toMatch(/export\s+function\s+WorkingChip\b/);
  });

  test("WorkingChip accepts a `startedAtMs` (or `startedAt`) prop typed as number", () => {
    const src = readFileSync(chipPath, "utf8");
    // The Design specifies `startedAtMs: number` on the props interface.
    expect(src).toMatch(/startedAt(?:Ms)?\s*[:?]\s*number/);
  });

  test("WorkingChip self-ticks via setInterval at 1000ms (ADR-005)", () => {
    const src = readFileSync(chipPath, "utf8");
    // Mirrors t3code's WorkingTimer pattern — `setInterval(..., 1000)`.
    expect(src).toMatch(/setInterval\([^,]+,\s*1000\s*\)/);
  });

  test("WorkingChip cleans up the interval on unmount", () => {
    const src = readFileSync(chipPath, "utf8");
    // useEffect returns a cleanup that calls clearInterval.
    expect(src).toMatch(/clearInterval\s*\(/);
  });

  test("WorkingChip renders the 'Working for {label}' copy (US-003 AC2)", () => {
    const src = readFileSync(chipPath, "utf8");
    // Visible label must literally read "Working for " followed by the
    // computed elapsed string.
    expect(src).toMatch(/Working for/);
  });

  test("WorkingChip's elapsed formatter mirrors t3code's formatWorkingTimer (Xs / Xm Ys / Xh Ym)", () => {
    const src = readFileSync(chipPath, "utf8");
    // Source must contain the "Xs" sub-minute branch and the seconds
    // computation. We verify by looking for the canonical template
    // strings.
    expect(src).toMatch(/`\$\{[^}]+\}s`/); // seconds template
    // And the hour/minute compound forms.
    const hasMinuteForm = /`\$\{[^}]+\}m( \$\{[^}]+\}s)?`/.test(src);
    const hasHourForm = /`\$\{[^}]+\}h( \$\{[^}]+\}m)?`/.test(src);
    expect(hasMinuteForm).toBe(true);
    expect(hasHourForm).toBe(true);
  });

  test("WorkingChip uses three pulsing dots (t3code visual treatment)", () => {
    const src = readFileSync(chipPath, "utf8");
    // Three `animate-pulse` markers — one per dot.
    const pulseMatches = src.match(/animate-pulse/g) ?? [];
    expect(pulseMatches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("T-003 MessagesTimeline renders WorkingChip below the timeline (US-003 AC1, AC5)", () => {
  test("MessagesTimeline imports WorkingChip", () => {
    const src = readFileSync(timelinePath, "utf8");
    expect(src).toMatch(/from\s+["']\.\/WorkingChip["']/);
    expect(src).toMatch(/\bWorkingChip\b/);
  });

  test("MessagesTimeline Props declares `activeTurnStartedAt: number | null`", () => {
    const src = readFileSync(timelinePath, "utf8");
    expect(src).toMatch(/activeTurnStartedAt\s*[:?]\s*number\s*\|\s*null/);
  });

  test("MessagesTimeline renders <WorkingChip> gated on `turnState === \"running\" && activeTurnStartedAt`", () => {
    const src = readFileSync(timelinePath, "utf8");
    // The chip render must be conditional on BOTH `turnState === "running"`
    // and `activeTurnStartedAt` (non-null).
    const renderRe =
      /turnState\s*===\s*["']running["'][\s\S]{0,80}activeTurnStartedAt[\s\S]{0,80}<WorkingChip\b/;
    const altRenderRe =
      /activeTurnStartedAt[\s\S]{0,80}turnState\s*===\s*["']running["'][\s\S]{0,80}<WorkingChip\b/;
    const hasGate = renderRe.test(src) || altRenderRe.test(src);
    expect(hasGate).toBe(true);
  });

  test("<WorkingChip> is rendered AFTER the timeline-rows .map() loop (sibling row at bottom — ADR-001)", () => {
    const src = readFileSync(timelinePath, "utf8");
    // The rendering loop is over `items` directly OR `rows` (the
    // derived TimelineRow[] used when consecutive tool-only assistant
    // messages get grouped into a work-group card). The chip must come
    // AFTER whichever loop the timeline uses so it stays at the bottom.
    const mapIdx = src.search(/(items|rows)\.map\(/);
    const chipIdx = src.indexOf("<WorkingChip");
    expect(mapIdx).toBeGreaterThan(0);
    expect(chipIdx).toBeGreaterThan(0);
    expect(chipIdx).toBeGreaterThan(mapIdx);
  });

  test("MessagesTimeline no longer carries the inline 'Working...' / 'Working…' placeholder block", () => {
    const src = readFileSync(timelinePath, "utf8");
    // The old inline block at :82-90 rendered the literal text
    // "Working..." or "Working…" with a single pulsing dot. The
    // replacement is the WorkingChip component, so this literal must
    // no longer appear in source.
    expect(src).not.toMatch(/>\s*Working(?:…|\.\.\.)\s*</);
  });

  test("inline 'Thinking…' / 'Thinking...' placeholder removed from AssistantRow", () => {
    const src = readFileSync(timelinePath, "utf8");
    // Per the task brief, the existing inline `blocks.length === 0 &&
    // streaming` "Thinking..." fallback at AssistantRow is removed —
    // it's redundant with the chip and contributed to bug 1's row spam.
    expect(src).not.toMatch(/>\s*Thinking(?:…|\.\.\.)\s*</);
  });
});

describe("T-003 live-chat reducer activeTurnStartedAt transitions (ADR-005)", () => {
  test("ChatState declares `activeTurnStartedAt: number | null`", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/activeTurnStartedAt\s*:\s*number\s*\|\s*null/);
  });

  test("EMPTY_STATE initialises `activeTurnStartedAt: null`", () => {
    const src = readFileSync(liveChatPath, "utf8");
    const emptyStateMatch = src.match(/EMPTY_STATE\s*:\s*ChatState\s*=\s*\{[\s\S]*?\};/);
    expect(emptyStateMatch).toBeTruthy();
    expect(emptyStateMatch![0]).toMatch(/activeTurnStartedAt\s*:\s*null/);
  });

  test("turn-state branch sets `activeTurnStartedAt` to Date.now() when entering running", () => {
    const src = readFileSync(liveChatPath, "utf8");
    const branch = extractCaseBranch(src, "turn-state");
    expect(branch).toBeTruthy();
    // The branch must reference Date.now() on the running transition.
    expect(branch!).toMatch(/Date\.now\(\)/);
    // And it must assign `activeTurnStartedAt`.
    expect(branch!).toMatch(/activeTurnStartedAt/);
  });

  test("turn-state branch preserves `activeTurnStartedAt` on running->running (no double-set)", () => {
    const src = readFileSync(liveChatPath, "utf8");
    const branch = extractCaseBranch(src, "turn-state");
    expect(branch).toBeTruthy();
    // The preserve-running case references `state.turnState !== "running"`
    // as the seed-gate OR references `state.activeTurnStartedAt` to keep
    // the existing value when already running.
    const hasPreserve =
      /state\.turnState\s*!==\s*["']running["']/.test(branch!) ||
      /state\.activeTurnStartedAt/.test(branch!);
    expect(hasPreserve).toBe(true);
  });

  test("turn-state branch clears `activeTurnStartedAt` to null on transition out of running", () => {
    const src = readFileSync(liveChatPath, "utf8");
    const branch = extractCaseBranch(src, "turn-state");
    expect(branch).toBeTruthy();
    // Loose: the branch's activeTurnStartedAt computation references `null`
    // somewhere (the clear path).
    expect(branch!).toMatch(/null/);
  });

  test("snapshot branch seeds `activeTurnStartedAt` based on body.turnState", () => {
    const src = readFileSync(liveChatPath, "utf8");
    const branch = extractCaseBranch(src, "snapshot");
    expect(branch).toBeTruthy();
    // The snapshot branch must assign `activeTurnStartedAt` based on the
    // incoming turnState (Date.now() when running, null otherwise).
    expect(branch!).toMatch(/activeTurnStartedAt/);
  });

  test("MessagesTimeline mount site passes `activeTurnStartedAt={state.activeTurnStartedAt}`", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/activeTurnStartedAt\s*=\s*\{\s*state\.activeTurnStartedAt\s*\}/);
  });
});

describe("T-003 single chip per turn invariant (US-003 AC4)", () => {
  test("MessagesTimeline source contains exactly one <WorkingChip occurrence", () => {
    const src = readFileSync(timelinePath, "utf8");
    const matches = src.match(/<WorkingChip\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
