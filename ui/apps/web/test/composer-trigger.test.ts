/**
 * Pure unit tests for the composer slash-command trigger detector +
 * ranking helper. Matches the project's node-only static-test convention
 * (vitest include glob: `apps/** /test/** /*.test.ts`, environment: node).
 */
import { describe, expect, test } from "vitest";

import {
  detectAtFileTrigger,
  detectSlashCommandTrigger,
  replaceTextRange,
} from "../src/lib/composer-trigger";

describe("detectSlashCommandTrigger", () => {
  test("returns null when the line does not start with /", () => {
    expect(detectSlashCommandTrigger("hello", 5)).toBeNull();
  });

  test("matches a bare / at cursor position", () => {
    const t = detectSlashCommandTrigger("/", 1);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("");
    expect(t!.rangeStart).toBe(0);
    expect(t!.rangeEnd).toBe(1);
  });

  test("captures the query after the slash", () => {
    const t = detectSlashCommandTrigger("/weav", 5);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("weav");
    expect(t!.rangeStart).toBe(0);
    expect(t!.rangeEnd).toBe(5);
  });

  test("returns null once the user types whitespace after the slash", () => {
    expect(detectSlashCommandTrigger("/weave ", 7)).toBeNull();
    expect(detectSlashCommandTrigger("/weave foo", 10)).toBeNull();
  });

  test("matches when / is the first non-newline char on a later line", () => {
    const text = "first line\n/weav";
    const t = detectSlashCommandTrigger(text, text.length);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("weav");
    // rangeStart points at the `/` (just after the newline).
    expect(text[t!.rangeStart]).toBe("/");
  });

  test("returns null when / is mid-line (not at line start)", () => {
    expect(detectSlashCommandTrigger("hello /weave", 12)).toBeNull();
  });

  test("clamps an out-of-range cursor", () => {
    const t = detectSlashCommandTrigger("/x", 999);
    expect(t).not.toBeNull();
    expect(t!.rangeEnd).toBe(2);
  });
});

describe("detectAtFileTrigger", () => {
  test("returns trigger at line-start `@foo` with cursor at end of token", () => {
    const t = detectAtFileTrigger("@foo", 4);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("foo");
    expect(t!.rangeStart).toBe(0);
    expect(t!.rangeEnd).toBe(4);
  });

  test("returns trigger for whitespace-prefixed mid-line `@bar`", () => {
    const t = detectAtFileTrigger("hello @bar", 10);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("bar");
    expect(t!.rangeStart).toBe(6);
    expect(t!.rangeEnd).toBe(10);
  });

  test("returns null when `@` has no whitespace before it (`email@foo`)", () => {
    expect(detectAtFileTrigger("email@foo", 9)).toBeNull();
  });

  test("returns null when whitespace lives inside the `@`-token (`@foo bar`)", () => {
    expect(detectAtFileTrigger("@foo bar", 8)).toBeNull();
  });

  test("returns null when the cursor is before the `@`", () => {
    expect(detectAtFileTrigger("hi @foo", 2)).toBeNull();
  });

  test("returns trigger with empty query for bare `@` at cursor", () => {
    const t = detectAtFileTrigger("@", 1);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("");
    expect(t!.rangeStart).toBe(0);
    expect(t!.rangeEnd).toBe(1);
  });

  test("matches `@` on the current line even when a previous line has `@x`", () => {
    const text = "line one @x\nline two @y";
    const t = detectAtFileTrigger(text, text.length);
    expect(t).not.toBeNull();
    expect(t!.query).toBe("y");
    expect(text[t!.rangeStart]).toBe("@");
    // The current-line `@y` rangeStart is at index 21.
    expect(t!.rangeStart).toBe(21);
    expect(t!.rangeEnd).toBe(23);
  });

  test("clamps an out-of-range cursor to text.length", () => {
    const t = detectAtFileTrigger("@foo", 999);
    expect(t).not.toBeNull();
    expect(t!.rangeEnd).toBe(4);
    expect(t!.query).toBe("foo");
  });
});

describe("replaceTextRange", () => {
  test("replaces the trigger range with the new text and returns the new cursor", () => {
    const r = replaceTextRange("/we", 0, 3, "/weave ");
    expect(r.text).toBe("/weave ");
    expect(r.cursor).toBe(7);
  });

  test("preserves surrounding text", () => {
    const text = "line 1\n/we";
    const r = replaceTextRange(text, 7, 10, "/weave ");
    expect(r.text).toBe("line 1\n/weave ");
    expect(r.cursor).toBe(text.length - 3 + "/weave ".length);
  });
});

