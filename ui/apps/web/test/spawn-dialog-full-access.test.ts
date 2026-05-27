/**
 * T-005 — Full-access subtitle copy + /spawn dev-note removal.
 *
 * Static-source scan style (matches the existing apps/web/test/*.test.ts
 * harness — Vitest include glob is `*.test.ts` only, runtime is `node`).
 *
 * Covers US-006 AC1 (subtitle names --dangerously-skip-permissions
 * and the trust boundary), US-006 AC2 (the persisted enum value is
 * the SDK-canonical `bypassPermissions`), and US-002 AC4 (the
 * dev-note copy is absent).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const dialogPath = webRoot + "src/routes/spawn-chat-dialog-live.tsx";

describe("T-005 Full-access preset subtitle (US-006 AC1, AC2)", () => {
  test("subtitle names --dangerously-skip-permissions", () => {
    const src = readFileSync(dialogPath, "utf8");
    const re =
      /id:\s*"bypassPermissions"[\s\S]{0,400}subtitle:\s*"([^"]+)"/;
    const m = re.exec(src);
    expect(m).toBeTruthy();
    expect(m![1]).toContain("--dangerously-skip-permissions");
  });

  test("subtitle names the local-environment / trust-boundary semantics", () => {
    const src = readFileSync(dialogPath, "utf8");
    const re =
      /id:\s*"bypassPermissions"[\s\S]{0,400}subtitle:\s*"([^"]+)"/;
    const m = re.exec(src);
    expect(m).toBeTruthy();
    expect(m![1].toLowerCase()).toContain("trust");
  });

  test("permission_mode enum value uses the SDK-canonical \"bypassPermissions\"", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The literal `"bypassPermissions"` must appear in the MODES table
    // so the persisted enum value matches the SDK shape used elsewhere.
    expect(src).toMatch(/id:\s*"bypassPermissions"/);
    // The legacy kebab-case slug must not linger in the source.
    expect(src).not.toMatch(/"trusted-vm"/);
  });
});

describe("T-005 /spawn dev-note removed (US-002 AC4)", () => {
  test("dev-note literal is absent from source", () => {
    const src = readFileSync(dialogPath, "utf8");
    expect(src).not.toContain(
      "v1: this checkbox is recorded but the chat still runs in the bare cwd",
    );
  });

  test("Worktree-mode checkbox is still rendered (US-002 AC4 belt-and-braces)", () => {
    const src = readFileSync(dialogPath, "utf8");
    // The checkbox is the `type="checkbox"` bound to `worktree` state.
    // It must still be present after the dev-note removal.
    expect(src).toMatch(/Worktree mode/);
    expect(src).toMatch(/checked=\{worktree\}/);
  });
});
