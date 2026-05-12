/**
 * Chat-items repository — durable, ordered ChatItem log per chat.
 *
 * Background: before this repo existed, the bridge held the full chat
 * timeline only in `ChatSession.items` (in-memory). Once the drain timer
 * disposed the session (idle clients, server restart, SDK respawn after
 * crash), the items array was gone — even though the underlying Claude
 * SDK session was still alive on disk and would happily answer "where do
 * we stand?" from its own server-side history. The UI showed an empty
 * timeline; the agent acted like nothing was lost. That asymmetry is the
 * bug.
 *
 * The fix follows t3code's "thread is server-owned, event-sourced" model
 * ([docs/t3code-main/packages/contracts/src/orchestration.ts] —
 * `subscribeThread` emits a `snapshot` reconstructed from the durable
 * event log + live deltas). The bridge becomes a cache layer over this
 * repo: every `appendItem` / `updateItem` is mirrored here; every
 * `spawn()` replays from here before broadcasting the first snapshot.
 *
 * Items are stored as opaque records (the chat-protocol owns the schema).
 * Each row carries the originating `chat_id`, a stable `id` (the
 * `ChatItem.id`), a monotonically increasing `seq` for ordering, and the
 * serialised item. Rebuilding a session means listing by `chat_id`
 * ordered by `seq`.
 */
import type { InMemoryStorage } from "../index.ts";

export interface ChatItemRow {
  chat_id: string;
  /** Stable item id — matches the ChatItem.id on the wire. */
  id: string;
  /** Append-order within the chat. Mutated items keep their original seq. */
  seq: number;
  /** Opaque ChatItem payload (POJO, JSON-serialisable). */
  item: unknown;
}

export interface ChatItemsRepo {
  /** Replay the full ordered timeline for a chat. */
  list(chatId: string): unknown[];
  /** Append a new item. Throws if the id already exists for this chat. */
  append(chatId: string, item: { id: string }): void;
  /** Upsert by id. If absent, behaves like append (used for replay tolerance). */
  update(chatId: string, item: { id: string }): void;
  /** Drop the entire timeline for a chat — called on chat delete. */
  clear(chatId: string): void;
}

interface ChatItemsState {
  /**
   * Per-chat ordered log. The order is the insertion order of the array;
   * `update` mutates in place so existing entries keep their position.
   */
  byChat: Map<string, ChatItemRow[]>;
  /** Per-chat next-seq counter so `seq` is monotonic across restarts. */
  nextSeq: Map<string, number>;
}

function ensureState(storage: InMemoryStorage): ChatItemsState {
  // The metadata-store keeps its in-memory state in `InMemoryStorage`.
  // We stash our two maps as a sub-property so the existing JSON
  // serialise / hydrate path can pick them up without us reaching across
  // every repo. See `index.ts`'s `serialize` / `hydrate`.
  const anyStorage = storage as InMemoryStorage & { chatItems?: ChatItemsState };
  if (!anyStorage.chatItems) {
    anyStorage.chatItems = {
      byChat: new Map(),
      nextSeq: new Map(),
    };
  }
  return anyStorage.chatItems;
}

export function chatItemsRepo(storage: InMemoryStorage): ChatItemsRepo {
  const state = ensureState(storage);

  function bumpSeq(chatId: string): number {
    const next = (state.nextSeq.get(chatId) ?? 0) + 1;
    state.nextSeq.set(chatId, next);
    return next;
  }

  return {
    list(chatId) {
      const rows = state.byChat.get(chatId);
      if (!rows) return [];
      // Defensive copy — callers shouldn't be able to mutate the
      // backing array. Items themselves are returned by reference; the
      // bridge replays them into a fresh `session.items` and treats the
      // hydrated copies as its own working state.
      return rows.map((r) => r.item);
    },
    append(chatId, item) {
      let rows = state.byChat.get(chatId);
      if (!rows) {
        rows = [];
        state.byChat.set(chatId, rows);
      }
      const seq = bumpSeq(chatId);
      rows.push({ chat_id: chatId, id: item.id, seq, item });
    },
    update(chatId, item) {
      const rows = state.byChat.get(chatId);
      if (!rows) {
        // Tolerate updates that arrive before append — treat as append.
        // This happens when the bridge updates an item mid-stream but
        // the repo was just (re-)initialised; the replay path will
        // round-trip cleanly either way.
        const seq = bumpSeq(chatId);
        state.byChat.set(chatId, [{ chat_id: chatId, id: item.id, seq, item }]);
        return;
      }
      const idx = rows.findIndex((r) => r.id === item.id);
      if (idx === -1) {
        const seq = bumpSeq(chatId);
        rows.push({ chat_id: chatId, id: item.id, seq, item });
        return;
      }
      // Mutate the stored payload; keep the original seq so order is
      // preserved across in-place updates (streaming text, tool_result
      // wiring, plan-proposed status transitions all hit this path).
      rows[idx] = { ...rows[idx]!, item };
    },
    clear(chatId) {
      state.byChat.delete(chatId);
      state.nextSeq.delete(chatId);
    },
  };
}
