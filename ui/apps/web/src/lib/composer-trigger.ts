/**
 * Pure trigger-detection + ranking for the composer slash-command menu.
 *
 * Adapted from the t3code reference (`apps/web/src/composer-logic.ts`,
 * `composerSlashCommandSearch.ts`) but reduced to what loom needs:
 *   - detect a `/<query>` token at the start of the current line
 *   - rank a flat `SlashCommandEntry[]` list against the query
 *   - splice a replacement into a (text, cursor) pair
 *
 * No DOM, no React, no shared deps — kept pure so the static-test
 * convention (`apps/** /test/** /*.test.ts`, node-only) can exercise it.
 */
import type { SlashCommandEntry } from "./api";

export interface SlashCommandTrigger {
  query: string;
  /** Inclusive — points at the leading `/`. */
  rangeStart: number;
  /** Exclusive — points at the cursor. */
  rangeEnd: number;
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

/**
 * Returns a trigger iff the current line up to the cursor matches
 * `^/<non-whitespace>*$` — i.e. the slash is the first non-whitespace
 * character of the current line and no whitespace has been typed
 * since. Returning `null` means the menu should be hidden.
 */
export function detectSlashCommandTrigger(
  text: string,
  cursorInput: number,
): SlashCommandTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const linePrefix = text.slice(lineStart, cursor);
  if (!linePrefix.startsWith("/")) return null;
  const match = /^\/(\S*)$/.exec(linePrefix);
  if (!match) return null;
  return {
    query: match[1] ?? "",
    rangeStart: lineStart,
    rangeEnd: cursor,
  };
}

export interface AtFileTrigger {
  query: string;
  /** Inclusive — points at the `@`. */
  rangeStart: number;
  /** Exclusive — points at the cursor. */
  rangeEnd: number;
}

/**
 * Returns a trigger iff the cursor is at the end of an `@<word>` token
 * whose `@` is at start-of-line / after whitespace and whose body has
 * no whitespace. Used by the composer's `@`-file picker (US-008 AC1,
 * AC4). Mirrors `detectSlashCommandTrigger`'s shape.
 *
 * Detection rule (per design ADR-D07 / B-15):
 *   1. Clamp the cursor.
 *   2. Walk back from cursor-1 to find the nearest `@` on the current
 *      line. If none, return null.
 *   3. Body = text.slice(at+1, cursor). If body contains any whitespace,
 *      return null (filters `@foo bar` — token already closed).
 *   4. charBefore (start-of-string / newline counts as whitespace) must
 *      be whitespace, else return null (filters `email@foo`).
 *   5. Otherwise return { query: body, rangeStart: at, rangeEnd: cursor }.
 */
export function detectAtFileTrigger(
  text: string,
  cursorInput: number,
): AtFileTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  // Walk back on the current line looking for `@`. Stop at newline.
  let atIndex = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n") break;
    if (ch === "@") {
      atIndex = i;
      break;
    }
  }
  if (atIndex === -1) return null;
  const body = text.slice(atIndex + 1, cursor);
  if (/\s/.test(body)) return null;
  // Treat start-of-string and newline as whitespace.
  const charBefore = atIndex === 0 ? "\n" : (text[atIndex - 1] ?? "\n");
  if (!/\s/.test(charBefore)) return null;
  return {
    query: body,
    rangeStart: atIndex,
    rangeEnd: cursor,
  };
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}

/**
 * Score a single command name against a normalized query. Lower is
 * better; `null` means "no match — drop from the list".
 *
 * Tiers (mirrors the t3code ranking shape, simplified):
 *   0 — exact match
 *   1 — prefix match
 *   2 — match at a `-` / `_` / `/` boundary
 *   3 — substring match anywhere
 *   null — no match
 */
function scoreName(name: string, query: string): number | null {
  if (query === "") return 3; // include everything, stable-sorted by name
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  for (const marker of ["-", "_", "/"]) {
    let idx = -1;
    while ((idx = n.indexOf(marker, idx + 1)) !== -1) {
      if (n.slice(idx + 1).startsWith(q)) return 2;
    }
  }
  if (n.includes(q)) return 3;
  return null;
}

/**
 * Filter + sort a slash-command list by relevance to the query. Stable
 * ordering: same-score items keep the input order (which the server
 * already sorts alphabetically). Project-scope wins over user-scope
 * when scores tie at the boundary — handled by the server's dedup
 * step, so we don't re-apply it here.
 */
export function rankSlashCommands(
  items: ReadonlyArray<SlashCommandEntry>,
  query: string,
): SlashCommandEntry[] {
  const trimmed = query.replace(/^\/+/, "");
  const scored: Array<{ item: SlashCommandEntry; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const s = scoreName(item.name, trimmed);
    if (s === null) return;
    scored.push({ item, score: s, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((e) => e.item);
}
