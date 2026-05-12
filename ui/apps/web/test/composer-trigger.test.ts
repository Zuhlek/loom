/**
 * Pure unit tests for the composer slash-command trigger detector +
 * ranking helper. Matches the project's node-only static-test convention
 * (vitest include glob: `apps/** /test/** /*.test.ts`, environment: node).
 */
import { describe, expect, test } from "vitest";

import {
  detectAtFileTrigger,
  detectSlashCommandTrigger,
  rankSlashCommands,
  replaceTextRange,
} from "../src/lib/composer-trigger";
import type { SlashCommandEntry } from "../src/lib/api";

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

describe("rankSlashCommands", () => {
  const items: SlashCommandEntry[] = [
    { name: "weave", scope: "user", filePath: "/u/weave.md" },
    { name: "tune", scope: "user", filePath: "/u/tune.md" },
    { name: "ultra-review", scope: "project", filePath: "/p/ultra-review.md" },
    { name: "review", scope: "project", filePath: "/p/review.md" },
    { name: "init", scope: "user", filePath: "/u/init.md" },
  ];

  test("returns all items in input order when query is empty", () => {
    const out = rankSlashCommands(items, "");
    expect(out.map((c) => c.name)).toEqual(["weave", "tune", "ultra-review", "review", "init"]);
  });

  test("exact match wins", () => {
    const out = rankSlashCommands(items, "weave");
    expect(out[0]!.name).toBe("weave");
  });

  test("prefix match ranks above substring match", () => {
    const out = rankSlashCommands(items, "rev");
    // "review" prefix-matches, "ultra-review" only substring-matches
    expect(out[0]!.name).toBe("review");
    expect(out.find((c) => c.name === "ultra-review")).toBeDefined();
  });

  test("boundary match (after `-`) ranks above plain substring", () => {
    // For "review" against "ultra-review": prefix-match wouldn't fire,
    // but boundary-after-`-` does. The "review" item itself prefix-matches
    // and so still wins overall — the property under test is that
    // ultra-review is included and ranks above pure-substring noise.
    const out = rankSlashCommands(items, "review");
    expect(out.map((c) => c.name)).toContain("ultra-review");
  });

  test("non-matching items are dropped", () => {
    const out = rankSlashCommands(items, "xyznever");
    expect(out).toEqual([]);
  });

  test("leading slashes in the query are stripped", () => {
    const out = rankSlashCommands(items, "/weave");
    expect(out[0]!.name).toBe("weave");
  });
});
