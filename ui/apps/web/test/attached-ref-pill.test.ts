/*
 * AttachedRefPill — composer bottom-right pill showing the chat's
 * currently attached git ref. Dimmed + "no git" copy for unknown
 * vcs_kind. Static-source assertions on the component file shape.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/AttachedRefPill.tsx";

describe("AttachedRefPill — composer attached-ref indicator", () => {
  test("file exists", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("exports AttachedRefPill + AttachedRefPillProps", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+AttachedRefPill\b/);
    expect(src).toMatch(/export\s+interface\s+AttachedRefPillProps/);
  });

  test("props include branch + vcsKind", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/branch\s*:\s*string\s*\|\s*null/);
    expect(src).toMatch(/vcsKind\s*:\s*"git"\s*\|\s*"unknown"/);
  });

  test("renders 'no git' copy when vcsKind === 'unknown'", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/no git/);
  });

  test("applies a dim class / muted-foreground style for the unknown branch", () => {
    const src = readFileSync(pillPath, "utf8");
    // Either a dedicated dim class OR the muted-foreground style token
    // is acceptable per ADR-008 (inline dim is enough).
    expect(src).toMatch(/muted-foreground|opacity|dim/);
  });

  test("renders the branch name when branch !== null", () => {
    const src = readFileSync(pillPath, "utf8");
    // The component must reference `branch` in JSX output.
    expect(src).toMatch(/\{branch[^}]*\}|\{props\.branch[^}]*\}/);
  });
});
