import { detectVcsKind } from "../git/vcs-kind.ts";
import { isGitRepo } from "../git/is-git-repo.ts";
import type { MetadataStore } from "../metadata-store/index.ts";

export interface PersistVcsKindResult {
  written: boolean;
  vcsKind: "git" | "unknown" | null;
}

export function persistVcsKindOnAttach(
  store: MetadataStore,
  chatId: string,
): PersistVcsKindResult {
  const chat = store.chats.get(chatId);
  if (!chat) return { written: false, vcsKind: null };

  const patch: { vcs_kind?: "git" | "unknown"; repo_name?: string | null } = {};
  const vcsKind = chat.vcs_kind ?? detectVcsKind(chat.cwd);
  if (chat.vcs_kind === null) patch.vcs_kind = vcsKind;
  // Fill the repo display name (git top-level basename) whenever it's
  // missing — covers both fresh chats and legacy rows that already had
  // vcs_kind but pre-date repo_name.
  if (chat.repo_name == null && vcsKind === "git") {
    patch.repo_name = isGitRepo(chat.cwd).repoName ?? null;
  }

  if (Object.keys(patch).length === 0) {
    return { written: false, vcsKind };
  }
  store.chats.update(chatId, patch);
  return { written: true, vcsKind };
}
