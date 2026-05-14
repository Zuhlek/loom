/**
 * Grep-guard enforcing the user's comment-style rules. Asserts that no
 * Forge artifact references (T-NNN / US-NNN / ADR-D*) appear in the live
 * source trees `ui/apps/web/src` and `ui/apps/server/src`, and that the
 * dead `<span hidden>{flatRows...}</span>` element + its `flatRows`
 * derivation are absent from {@link ComposerSlashMenu}.
 *
 * Test files are out of scope — `describe(...)` blocks legitimately
 * reference task IDs.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webSrc = join(repoRoot, "ui/apps/web/src");
const serverSrc = join(repoRoot, "ui/apps/server/src");
const composerSlashMenu = join(webSrc, "components/chat/ComposerSlashMenu.tsx");

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bT-\d{3}\b/,
  /\bUS-\d{3}\b/,
  /\bADR-D\d+\b/,
];

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (/\.(tsx|ts)$/.test(name)) out.push(full);
    }
  }
  return out;
}

describe("comment-style sweep — live source trees", () => {
  test("no T-NNN / US-NNN / ADR-D* references in web/src or server/src", () => {
    const offenders: Array<{ file: string; line: number; text: string; pattern: string }> = [];
    for (const root of [webSrc, serverSrc]) {
      for (const file of walkSourceFiles(root)) {
        const lines = readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(lines[i])) {
              offenders.push({
                file: file.slice(repoRoot.length),
                line: i + 1,
                text: lines[i].trim(),
                pattern: pattern.source,
              });
            }
          }
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  test("ComposerSlashMenu has no <span hidden>{flatRows dead element", () => {
    const text = readFileSync(composerSlashMenu, "utf8");
    expect(text).not.toMatch(/<span\s+hidden\s*>\s*\{flatRows/);
    expect(text).not.toMatch(/\bconst\s+flatRows\s*:/);
  });
});
