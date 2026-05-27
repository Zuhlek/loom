// Pure branch-selection classifier — returns reuse | switch | drop.
export interface BranchSelectionRef {
  isDefault: boolean;
  worktreePath: string | null;
  name: string;
}

export interface BranchSelectionInput {
  activeProjectCwd: string;
  activeWorktreePath: string | null;
  refName: BranchSelectionRef;
}

export type BranchSelectionKind = "reuse" | "switch" | "drop";

export interface BranchSelectionTarget {
  kind: BranchSelectionKind;
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
}

export function resolveBranchSelectionTarget(input: BranchSelectionInput): BranchSelectionTarget {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  // Case 1 — the target ref already has a worktree backing it. Reuse it.
  if (refName.worktreePath !== null) {
    return {
      kind: "reuse",
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  // Case 2 — chat is currently in a worktree.
  if (activeWorktreePath !== null) {
    if (refName.isDefault) {
      // Switching back to the default branch within the same worktree
      // is the legal "in-worktree" mode change.
      return {
        kind: "switch",
        checkoutCwd: activeWorktreePath,
        nextWorktreePath: activeWorktreePath,
        reuseExistingWorktree: false,
      };
    }
    // Non-default ref + no backing worktree → drop to project cwd.
    return {
      kind: "drop",
      checkoutCwd: activeProjectCwd,
      nextWorktreePath: null,
      reuseExistingWorktree: false,
    };
  }

  // Case 3 — chat is in local mode. Plain `git checkout` in place.
  return {
    kind: "switch",
    checkoutCwd: activeProjectCwd,
    nextWorktreePath: null,
    reuseExistingWorktree: false,
  };
}
