/**
 * Unit tests for `synthesizeEditDiff` and `synthesizeWriteDiff` — T-001.
 *
 * Covers: identical no-op, append-only, prepend-only, middle-replace,
 * full-rewrite, multi-line Edit, over-cap fallback, Write all-add,
 * and trailing-\r stripping.
 */
import { describe, expect, test } from "vitest";

import {
  synthesizeEditDiff,
  synthesizeWriteDiff,
} from "../src/lib/diff-synthesize";

function lines(file: { hunks: { kind: string; text: string }[][] }) {
  return file.hunks.flat();
}

describe("synthesizeEditDiff", () => {
  test("identical input → status modified, zero adds + dels, only context lines", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "alpha\nbeta\ngamma",
      newString: "alpha\nbeta\ngamma",
    });
    expect(file.path).toBe("src/a.ts");
    expect(file.status).toBe("modified");
    expect(file.added).toBe(0);
    expect(file.removed).toBe(0);
    const flat = lines(file);
    expect(flat.every((l) => l.kind === "context")).toBe(true);
    expect(flat).toHaveLength(3);
  });

  test("append-only → leading context plus trailing add(s)", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "a\nb",
      newString: "a\nb\nc\nd",
    });
    expect(file.status).toBe("modified");
    expect(file.added).toBe(2);
    expect(file.removed).toBe(0);
    const flat = lines(file);
    expect(flat[0]).toEqual({ kind: "context", text: "a" });
    expect(flat[1]).toEqual({ kind: "context", text: "b" });
    expect(flat[2]).toEqual({ kind: "add", text: "c" });
    expect(flat[3]).toEqual({ kind: "add", text: "d" });
  });

  test("prepend-only → leading add(s) plus trailing context", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "y\nz",
      newString: "x\ny\nz",
    });
    expect(file.added).toBe(1);
    expect(file.removed).toBe(0);
    const flat = lines(file);
    expect(flat[0]).toEqual({ kind: "add", text: "x" });
    expect(flat[1]).toEqual({ kind: "context", text: "y" });
    expect(flat[2]).toEqual({ kind: "context", text: "z" });
  });

  test("middle-replace → del-then-add segment between context lines", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "a\nb\nc",
      newString: "a\nB\nc",
    });
    expect(file.added).toBe(1);
    expect(file.removed).toBe(1);
    const flat = lines(file);
    expect(flat[0]).toEqual({ kind: "context", text: "a" });
    // del before add in a replace
    const delIdx = flat.findIndex((l) => l.kind === "del");
    const addIdx = flat.findIndex((l) => l.kind === "add");
    expect(delIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(delIdx);
    expect(flat[delIdx]).toEqual({ kind: "del", text: "b" });
    expect(flat[addIdx]).toEqual({ kind: "add", text: "B" });
    expect(flat[flat.length - 1]).toEqual({ kind: "context", text: "c" });
  });

  test("full rewrite (no common lines) → all-del-then-all-add", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "one\ntwo",
      newString: "ALPHA\nBETA",
    });
    expect(file.added).toBe(2);
    expect(file.removed).toBe(2);
    const flat = lines(file);
    // All dels precede all adds when there's no common subsequence.
    const lastDel = flat.map((l) => l.kind).lastIndexOf("del");
    const firstAdd = flat.map((l) => l.kind).indexOf("add");
    expect(lastDel).toBeGreaterThan(-1);
    expect(firstAdd).toBeGreaterThan(lastDel);
  });

  test("multi-line Edit folds into a single hunk", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "a\nb\nc\nd\ne",
      newString: "a\nB\nc\nD\ne",
    });
    // One hunk, multiple ops.
    expect(file.hunks).toHaveLength(1);
    expect(file.added).toBe(2);
    expect(file.removed).toBe(2);
  });

  test("trailing \\r is stripped on both sides", () => {
    const file = synthesizeEditDiff({
      filePath: "src/a.ts",
      oldString: "alpha\r\nbeta\r",
      newString: "alpha\r\nBETA\r",
    });
    for (const l of lines(file)) {
      expect(l.text.endsWith("\r")).toBe(false);
    }
    expect(file.added).toBe(1);
    expect(file.removed).toBe(1);
  });

  test("over-cap (>1000 lines either side) → meta fallback + all-del-then-all-add", () => {
    const oldStr = Array.from({ length: 1500 }, (_, i) => `o${i}`).join("\n");
    const newStr = Array.from({ length: 1500 }, (_, i) => `n${i}`).join("\n");
    const file = synthesizeEditDiff({
      filePath: "src/big.ts",
      oldString: oldStr,
      newString: newStr,
    });
    expect(file.status).toBe("modified");
    expect(file.hunks).toHaveLength(1);
    const flat = file.hunks[0];
    expect(flat[0].kind).toBe("meta");
    expect(flat[0].text).toContain("input too large");
    const dels = flat.filter((l) => l.kind === "del");
    const adds = flat.filter((l) => l.kind === "add");
    expect(dels).toHaveLength(1500);
    expect(adds).toHaveLength(1500);
    // all dels before all adds
    const lastDel = flat.map((l) => l.kind).lastIndexOf("del");
    const firstAdd = flat.map((l) => l.kind).indexOf("add");
    expect(firstAdd).toBeGreaterThan(lastDel);
    expect(file.added).toBe(1500);
    expect(file.removed).toBe(1500);
  });
});

describe("synthesizeWriteDiff", () => {
  test("Write input → status added, all-add lines", () => {
    const file = synthesizeWriteDiff({
      filePath: "src/new.ts",
      content: "first\nsecond\nthird",
    });
    expect(file.path).toBe("src/new.ts");
    expect(file.status).toBe("added");
    expect(file.added).toBe(3);
    expect(file.removed).toBe(0);
    const flat = lines(file);
    expect(flat.every((l) => l.kind === "add")).toBe(true);
    expect(flat.map((l) => l.text)).toEqual(["first", "second", "third"]);
  });

  test("Write trailing-\\r stripping", () => {
    const file = synthesizeWriteDiff({
      filePath: "src/new.ts",
      content: "a\r\nb\r",
    });
    for (const l of lines(file)) {
      expect(l.text.endsWith("\r")).toBe(false);
    }
  });
});
