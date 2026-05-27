import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBranchSelectionTarget,
  type BranchSelectionInput,
} from "../src/git/resolve-branch-selection-target.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("resolveBranchSelectionTarget (T-005)", () => {
  test("ref with worktreePath → kind=reuse + reuseExistingWorktree=true", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/proj",
      activeWorktreePath: null,
      refName: { isDefault: false, worktreePath: "/proj/.loom-worktrees/x/abc", name: "feat" },
    };
    const out = resolveBranchSelectionTarget(input);
    expect(out.kind).toBe("reuse");
    expect(out.reuseExistingWorktree).toBe(true);
    expect(out.nextWorktreePath).toBe("/proj/.loom-worktrees/x/abc");
    expect(out.checkoutCwd).toBe("/proj/.loom-worktrees/x/abc");
  });

  test("no worktreePath, chat in worktree mode, ref is default → kind=switch", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/proj",
      activeWorktreePath: "/proj/.loom-worktrees/x/abc",
      refName: { isDefault: true, worktreePath: null, name: "main" },
    };
    const out = resolveBranchSelectionTarget(input);
    expect(out.kind).toBe("switch");
    expect(out.reuseExistingWorktree).toBe(false);
    expect(out.checkoutCwd).toBe("/proj/.loom-worktrees/x/abc");
    expect(out.nextWorktreePath).toBe("/proj/.loom-worktrees/x/abc");
  });

  test("no worktreePath, chat in worktree mode, ref is non-default → kind=drop", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/proj",
      activeWorktreePath: "/proj/.loom-worktrees/x/abc",
      refName: { isDefault: false, worktreePath: null, name: "feat" },
    };
    const out = resolveBranchSelectionTarget(input);
    expect(out.kind).toBe("drop");
    expect(out.reuseExistingWorktree).toBe(false);
    expect(out.checkoutCwd).toBe("/proj");
    expect(out.nextWorktreePath).toBeNull();
  });

  test("no worktreePath, chat in local mode, ref is default → kind=switch", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/proj",
      activeWorktreePath: null,
      refName: { isDefault: true, worktreePath: null, name: "main" },
    };
    const out = resolveBranchSelectionTarget(input);
    expect(out.kind).toBe("switch");
    expect(out.checkoutCwd).toBe("/proj");
    expect(out.nextWorktreePath).toBeNull();
  });

  test("no worktreePath, chat in local mode, ref is non-default → kind=switch (in-place checkout)", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/proj",
      activeWorktreePath: null,
      refName: { isDefault: false, worktreePath: null, name: "feat" },
    };
    const out = resolveBranchSelectionTarget(input);
    expect(out.kind).toBe("switch");
    expect(out.checkoutCwd).toBe("/proj");
    expect(out.nextWorktreePath).toBeNull();
  });

  test("idempotence — same input yields same output across two calls", () => {
    const input: BranchSelectionInput = {
      activeProjectCwd: "/p",
      activeWorktreePath: "/p/.w/a",
      refName: { isDefault: false, worktreePath: null, name: "b" },
    };
    const a = resolveBranchSelectionTarget(input);
    const b = resolveBranchSelectionTarget(input);
    expect(a).toEqual(b);
  });

  test("module source imports zero side-effecting modules", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/git/resolve-branch-selection-target.ts"),
      "utf8",
    );
    // No node:fs, node:child_process, no value import of executeGit / git
    // helpers. Only type imports allowed for IO-bearing names.
    expect(src).not.toMatch(/from\s+["']node:fs["']/);
    expect(src).not.toMatch(/from\s+["']node:child_process["']/);
    expect(src).not.toMatch(/from\s+["']node:fs\/promises["']/);
    // executeGit lives in ./worktree.ts — make sure we don't import it
    // (type-only `import type` is fine; the assertion below rules out
    // value-level imports).
    expect(src).not.toMatch(/^import\s+\{[^}]*executeGit[^}]*\}\s+from/m);
  });
});
