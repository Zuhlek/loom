export type VcsVerbKind =
  | "commit"
  | "push"
  | "pr"
  | "switchRef"
  | "createRef"
  | "createWorktree"
  | "removeWorktree"
  | "checkoutChangeRequest";

export type VcsVerbReason = "not-a-git-repo" | "unsupported-provider";

const VERB_NOUN: Record<VcsVerbKind, string> = {
  commit: "Commit",
  push: "Push",
  pr: "Pull request",
  switchRef: "Switch branch",
  createRef: "Create branch",
  createWorktree: "Create worktree",
  removeWorktree: "Remove worktree",
  checkoutChangeRequest: "Check out change request",
};

export function vcsVerbTooltip(verbKind: VcsVerbKind, reason: VcsVerbReason): string {
  const verb = VERB_NOUN[verbKind];
  if (reason === "not-a-git-repo") {
    return `${verb} unavailable — this project is not a git repository.`;
  }
  return `${verb} unavailable — unsupported source-control provider for this remote.`;
}
