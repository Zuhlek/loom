import { detectVcsKind } from "../git/vcs-kind.ts";
import { isGitRepo } from "../git/is-git-repo.ts";
import { readCurrentBranch } from "../git/head.ts";
import type { MetadataStore } from "../metadata-store/index.ts";

export interface ReconcileGitContextResult {
  vcsKind: "git" | "unknown" | null;
  repoName: string | null;
  branch: string | null;
  /** `vcs_kind` and/or `repo_name` were corrected on the row. */
  vcsChanged: boolean;
  /** `branch` was corrected on the row. */
  branchChanged: boolean;
}

/**
 * Re-derive a chat's git context on attach and self-heal a stale row.
 *
 * The row's `vcs_kind` / `branch` are snapshotted once (at first attach and
 * first-send respectively) and never revisited — so a value frozen during a
 * transient mount fault (an EIO misread as "no git", or a null branch) stays
 * wrong forever. This re-probes and corrects it. A `null` probe means the
 * filesystem was momentarily unreadable — we never downgrade a known value on
 * that, so the answer only ever moves toward the truth. Returns the effective
 * values plus flags so the caller can broadcast the corrections to live
 * clients (a reload otherwise picks them up from the persisted row).
 */
export function reconcileGitContextOnAttach(
  store: MetadataStore,
  chatId: string,
): ReconcileGitContextResult {
  const chat = store.chats.get(chatId);
  if (!chat) {
    return { vcsKind: null, repoName: null, branch: null, vcsChanged: false, branchChanged: false };
  }

  const patch: { vcs_kind?: "git" | "unknown"; repo_name?: string | null; branch?: string | null } = {};

  // vcs_kind: re-probe; correct null→value and a wrong known value alike, but
  // never persist `null` (indeterminate — a transient I/O error).
  const probed = detectVcsKind(chat.cwd);
  let vcsKind = chat.vcs_kind;
  if (probed !== null && probed !== chat.vcs_kind) {
    patch.vcs_kind = probed;
    vcsKind = probed;
  }

  let repoName = chat.repo_name ?? null;
  let branch = chat.branch ?? null;
  if (vcsKind === "git") {
    const probe = isGitRepo(chat.cwd);
    if (probe.repoName && probe.repoName !== chat.repo_name) {
      patch.repo_name = probe.repoName;
      repoName = probe.repoName;
    }
    // Only local-mode chats track the project HEAD; worktree-mode chats own
    // their branch, and a null mode is still pending first-send.
    if (chat.worktree_mode === "local") {
      const head = readCurrentBranch(probe.topLevel ?? chat.cwd);
      if (head !== null && head !== chat.branch) {
        patch.branch = head;
        branch = head;
      }
    }
  }

  const vcsChanged = patch.vcs_kind !== undefined || patch.repo_name !== undefined;
  const branchChanged = patch.branch !== undefined;
  if (vcsChanged || branchChanged) {
    store.chats.update(chatId, patch);
  }
  return { vcsKind, repoName, branch, vcsChanged, branchChanged };
}
