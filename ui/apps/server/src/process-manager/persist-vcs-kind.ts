import { detectVcsKind } from "../git/vcs-kind.ts";
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
  if (chat.vcs_kind !== null) {
    return { written: false, vcsKind: chat.vcs_kind };
  }
  const kind = detectVcsKind(chat.cwd);
  store.chats.update(chatId, { vcs_kind: kind });
  return { written: true, vcsKind: kind };
}
