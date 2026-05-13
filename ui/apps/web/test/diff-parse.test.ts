/**
 * Unit tests for `parseUnifiedDiff` — T-001.
 *
 * Loads six representative unified-diff fixtures from
 * `test/fixtures/diffs/` and asserts the produced `DiffFile[]` shape.
 * Plus a truncation case (>200 hunks) and a CR-stripping case.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseUnifiedDiff } from "../src/lib/diff-parse";
import type { DiffFile } from "../src/components/diff/DiffPanel";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "fixtures", "diffs", name), "utf8");

function only<T>(arr: T[]): T {
  expect(arr).toHaveLength(1);
  return arr[0];
}

describe("parseUnifiedDiff — fixture matrix", () => {
  test("modified.diff → single modified file with adds + dels", () => {
    const files = parseUnifiedDiff(fixture("modified.diff"));
    const file = only(files);
    expect(file.path).toBe("src/greeting.ts");
    expect(file.status).toBe("modified");
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);
    expect(file.hunks.length).toBeGreaterThan(0);
    const lines = file.hunks.flat();
    expect(lines.some((l) => l.kind === "add" && l.text.includes("Hello"))).toBe(true);
    expect(lines.some((l) => l.kind === "del" && l.text.includes('"Hi, "'))).toBe(true);
  });

  test("added.diff → status added, all-add hunk lines", () => {
    const files = parseUnifiedDiff(fixture("added.diff"));
    const file = only(files);
    expect(file.path).toBe("src/newfile.ts");
    expect(file.status).toBe("added");
    expect(file.added).toBe(3);
    expect(file.removed).toBe(0);
    const adds = file.hunks.flat().filter((l) => l.kind === "add");
    expect(adds).toHaveLength(3);
  });

  test("deleted.diff → status deleted, all-del hunk lines", () => {
    const files = parseUnifiedDiff(fixture("deleted.diff"));
    const file = only(files);
    expect(file.path).toBe("src/oldfile.ts");
    expect(file.status).toBe("deleted");
    expect(file.added).toBe(0);
    expect(file.removed).toBe(2);
    const dels = file.hunks.flat().filter((l) => l.kind === "del");
    expect(dels).toHaveLength(2);
  });

  test("rename-pure.diff → status renamed, post-rename path, no body", () => {
    const files = parseUnifiedDiff(fixture("rename-pure.diff"));
    const file = only(files);
    expect(file.path).toBe("src/new-name.ts");
    expect(file.status).toBe("renamed");
    expect(file.added).toBe(0);
    expect(file.removed).toBe(0);
    expect(file.hunks.flat().filter((l) => l.kind === "add" || l.kind === "del")).toHaveLength(0);
  });

  test("rename-modified.diff → status renamed, post-rename path, body hunks present", () => {
    const files = parseUnifiedDiff(fixture("rename-modified.diff"));
    const file = only(files);
    expect(file.path).toBe("src/after.ts");
    expect(file.status).toBe("renamed");
    expect(file.added).toBe(1);
    expect(file.removed).toBe(1);
  });

  test("binary.diff → empty-hunks DiffFile, status modified, zero counts", () => {
    const files = parseUnifiedDiff(fixture("binary.diff"));
    const file = only(files);
    expect(file.path).toBe("assets/logo.png");
    expect(file.status).toBe("modified");
    expect(file.added).toBe(0);
    expect(file.removed).toBe(0);
    expect(file.hunks).toEqual([]);
  });
});

describe("parseUnifiedDiff — caps and hygiene", () => {
  test("strips trailing \\r from every line", () => {
    // Same as modified.diff but with CRLF line endings.
    const crlf = fixture("modified.diff").replace(/\n/g, "\r\n");
    const file = only(parseUnifiedDiff(crlf));
    for (const line of file.hunks.flat()) {
      expect(line.text.endsWith("\r")).toBe(false);
    }
  });

  test("caps emitted hunks per file at 200 with a '(truncated)' meta line", () => {
    // Construct a synthetic diff with 250 single-line hunks.
    const header =
      "diff --git a/big.ts b/big.ts\n" +
      "index 1111111..2222222 100644\n" +
      "--- a/big.ts\n" +
      "+++ b/big.ts\n";
    const hunks: string[] = [];
    for (let i = 0; i < 250; i++) {
      const line = i + 1;
      hunks.push(
        `@@ -${line},1 +${line},1 @@\n` +
          `-old line ${i}\n` +
          `+new line ${i}\n`,
      );
    }
    const big = header + hunks.join("");
    const file: DiffFile = only(parseUnifiedDiff(big));

    // Exactly 200 real hunks plus a final truncation hunk.
    expect(file.hunks.length).toBe(201);
    const last = file.hunks[file.hunks.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].kind).toBe("meta");
    expect(last[0].text).toContain("truncated");

    // Counts reflect only the hunks actually emitted (200, not 250).
    expect(file.added).toBe(200);
    expect(file.removed).toBe(200);
  });
});
