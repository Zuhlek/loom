/**
 * Pure trigger-detection helpers for the composer slash-command and
 * @-file menus. Detects a `/<query>` token at the start of the current
 * line, an `@<query>` token after whitespace, and splices a replacement
 * into a (text, cursor) pair. No DOM, no React, no shared deps — kept
 * pure so the static-test convention (`apps/** /test/** /*.test.ts`,
 * node-only) can exercise it.
 */
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
 * no whitespace. Used by the composer's `@`-file picker. Mirrors
 * `detectSlashCommandTrigger`'s shape.
 *
 * Detection rule:
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
