/**
 * Decorates a `ChatRow` for API responses.
 *
 * Post-pty-pivot the surface is intentionally thin: just the persisted
 * row plus an optional `custom_name` reflection. SDK-era fields (auto
 * title from chat-items, live turn state from the bridge) are removed —
 * the PTY surface has no equivalent state machine. Tasks panel feeds
 * from JSONL directly; the row carries no liveness.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatRow } from "../metadata-store/repos/chat.ts";

export type ApiChat = ChatRow & {
  custom_name: string | null;
};

export function decorateChat(chat: ChatRow, _store: MetadataStore): ApiChat {
  const customName = (chat as ChatRow & { custom_name?: string | null }).custom_name ?? null;
  return { ...chat, custom_name: customName };
}
