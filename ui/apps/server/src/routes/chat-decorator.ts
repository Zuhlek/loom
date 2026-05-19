import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatRow } from "../metadata-store/repos/chat.ts";
import type { TurnState, UserMessageItem } from "../chat-protocol/messages.ts";

const AUTO_TITLE_VISIBLE_CAP = 60;

/**
 * Per-chat liveness snapshot surfaced on the decorated `ApiChat` so the
 * sidebar can render a status indicator (running / needs-input / idle)
 * without opening a WS to every chat. Sourced from the bridge's in-memory
 * `ChatSession` map; `null` when no live session is attached.
 */
export interface ChatLiveState {
  turnState: TurnState;
  needsInput: boolean;
}

export type ApiChat = ChatRow & {
  custom_name: string | null;
  auto_title: string | null;
  /** Liveness state from the bridge. `null` for inert / unattached chats. */
  live: ChatLiveState | null;
};

/** Callback the route layer passes through so the decorator stays pure. */
export type LiveStateFor = (chatId: string) => ChatLiveState | null;

export function decorateChat(
  chat: ChatRow,
  store: MetadataStore,
  liveStateFor?: LiveStateFor,
): ApiChat {
  const customName = (chat as ChatRow & { custom_name?: string | null }).custom_name ?? null;
  return {
    ...chat,
    custom_name: customName,
    auto_title: deriveAutoTitle(chat.id, store),
    live: liveStateFor ? liveStateFor(chat.id) : null,
  };
}

export function deriveAutoTitle(chatId: string, store: MetadataStore): string | null {
  const items = store.chatItems.list(chatId) ?? [];
  for (const item of items as Array<{ kind?: string } | undefined>) {
    if (!item || item.kind !== "user-message") continue;
    const text = (item as UserMessageItem).text;
    if (typeof text !== "string") continue;
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length === 0) continue;
    return collapsed.length > AUTO_TITLE_VISIBLE_CAP
      ? collapsed.slice(0, AUTO_TITLE_VISIBLE_CAP - 1).trimEnd() + "…"
      : collapsed;
  }
  return null;
}
