/**
 * Grep-guard for the FS slash-command scanner deletion. Asserts that the
 * symbol names `scan.ts`, `getSlashCommands`, `SlashCommandEntry`, and
 * the `/slash-commands` HTTP route path are absent from the live source
 * trees, and that the scanner / route files themselves no longer exist.
 *
 * Mirrors `dev-route-deletion.test.ts`'s static-source scan style.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const webSrc = join(repoRoot, "ui/apps/web/src");
const serverSrc = join(repoRoot, "ui/apps/server/src");

const DELETED_FILES = [
  "ui/apps/server/src/slash-commands/scan.ts",
  "ui/apps/server/src/routes/slash-commands.ts",
] as const;

/**
 * Forbidden identifiers / route paths. Each must be absent from every
 * source file walked below. Quoted route path is escaped at the use
 * site; we just search for the bare needle.
 */
const FORBIDDEN_NEEDLES = [
  "scanSlashCommands",
  "getSlashCommands",
  "SlashCommandEntry",
  "mountSlashCommandsRoute",
  "/slash-commands",
] as const;

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
      if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
  }
  return out;
}

describe("FS slash-command scanner deletion (T-006)", () => {
  test("scanner + route source files are absent from disk", () => {
    for (const rel of DELETED_FILES) {
      const full = join(repoRoot, rel);
      expect(existsSync(full), `${rel} must be deleted`).toBe(false);
    }
  });

  test("no forbidden symbol / route path appears in web/src or server/src", () => {
    const offenders: Array<{ file: string; needle: string }> = [];
    for (const root of [webSrc, serverSrc]) {
      for (const file of walkSourceFiles(root)) {
        const text = readFileSync(file, "utf8");
        for (const needle of FORBIDDEN_NEEDLES) {
          if (text.includes(needle)) {
            offenders.push({ file, needle });
          }
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
