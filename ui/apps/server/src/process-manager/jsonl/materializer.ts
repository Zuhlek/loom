/**
 * jsonl/materializer.ts — per-chat fold of `ClaudeEvent` → `ChatItem[]` +
 * `ServerFrame[]` deltas.
 *
 * Stateful (one instance per chat); pure with respect to its inputs (no
 * I/O, no time-of-call). Dedupes on `event.id` so replaying the same
 * transcript is idempotent — required for the reattach-replay contract
 * and for the materializer to absorb tail rotations safely.
 *
 * Frame emission is the materializer's sole side-effecting return: each
 * `ingest(event)` call returns the `ServerFrame[]` that the caller should
 * fan out to attached WS clients. `snapshot()` is the synchronous catchup
 * mechanism. `reset()` is the explicit clear-state hook used by
 * `retrySession`.
 *
 * Mapping summary (kept narrow to the catalog scope):
 *
 *   text (user)        → UserMessageItem            (item-append)
 *   text (assistant)   → AssistantMessageItem       (item-append / item-update)
 *   tool_use           → AssistantMessageItem with
 *                        tool_use block             (item-append / item-update)
 *   tool_result        → updates the matching       (item-update)
 *                        assistant message's
 *                        tool_use block status
 *   todo_write         → tasks-update frame; the
 *                        TodoWrite tool_use itself
 *                        is NOT rendered as an item
 *                        (matches today's SDK
 *                        bridge behaviour)
 *   session_meta       → session-state frame (lifecycle pass-through)
 *   slash_command_set  → slash-commands-update frame
 *   context_usage      → context-usage-update frame
 *   unknown            → absorbed silently
 */

import type { ClaudeEvent } from "./schema.ts";
import type {
  AssistantBlock,
  AssistantMessageItem,
  AssistantTextBlock,
  AssistantToolUseBlock,
  ChatItem,
  Task,
  UserMessageItem,
} from "../../chat-protocol/messages.ts";
import type {
  ItemAppendFrame,
  ItemUpdateFrame,
  ServerFrame,
} from "../../chat-protocol/frames.ts";

export interface MaterializerOptions {
  /** Chat id stamped on every emitted frame. Defaults to the first event's chatId. */
  chatId?: string;
}

export interface MaterializerSnapshot {
  items: ChatItem[];
  tasks: Task[];
}

export interface Materializer {
  ingest(event: ClaudeEvent): ServerFrame[];
  snapshot(): MaterializerSnapshot;
  reset(): void;
  /** Current chat id (after the first event or explicit init). */
  readonly chatId: string;
}

export function createMaterializer(opts: MaterializerOptions = {}): Materializer {
  /** Dedupe key set — `event.id` of every event we have already folded. */
  const seen = new Set<string>();
  const itemsById = new Map<string, ChatItem>();
  /** Stable insertion order — `ChatItem[]` is rendered in this order. */
  const itemOrder: string[] = [];
  let tasks: Task[] = [];
  let chatId = opts.chatId ?? "";

  function appendFrame(item: ChatItem): ItemAppendFrame {
    return {
      kind: "item-append",
      "chat-id": chatId,
      body: { item },
    };
  }

  function updateFrame(item: ChatItem): ItemUpdateFrame {
    return {
      kind: "item-update",
      "chat-id": chatId,
      body: { item },
    };
  }

  function appendItem(item: ChatItem): void {
    itemsById.set(item.id, item);
    itemOrder.push(item.id);
  }

  function items(): ChatItem[] {
    const out: ChatItem[] = [];
    for (const id of itemOrder) {
      const it = itemsById.get(id);
      if (it) out.push(it);
    }
    return out;
  }

  function ingestOne(event: ClaudeEvent): ServerFrame[] {
    if (!chatId) chatId = event.chatId;
    if (seen.has(event.id)) return [];
    seen.add(event.id);

    switch (event.kind) {
      case "text": {
        if (event.role === "user") {
          const item: UserMessageItem = {
            kind: "user-message",
            id: event.id,
            turnId: event.id,
            text: event.text,
            createdAt: event.tsIso,
          };
          appendItem(item);
          return [appendFrame(item)];
        }
        // assistant text
        const block: AssistantTextBlock = { type: "text", text: event.text };
        const item: AssistantMessageItem = {
          kind: "assistant-message",
          id: event.id,
          turnId: event.id,
          blocks: [block],
          streaming: false,
          createdAt: event.tsIso,
          updatedAt: event.tsIso,
        };
        appendItem(item);
        return [appendFrame(item)];
      }

      case "tool_use": {
        const block: AssistantToolUseBlock = {
          type: "tool_use",
          id: event.toolUseId || event.id,
          name: event.toolName,
          input: (event.input as Record<string, unknown>) ?? {},
          status: "running",
        };
        const item: AssistantMessageItem = {
          kind: "assistant-message",
          id: event.id,
          turnId: event.id,
          blocks: [block],
          streaming: false,
          createdAt: event.tsIso,
          updatedAt: event.tsIso,
        };
        appendItem(item);
        return [appendFrame(item)];
      }

      case "tool_result": {
        // Find the assistant-message item whose tool_use block matches.
        const targetUseId = event.toolUseId;
        let updated: ChatItem | undefined;
        for (const id of itemOrder) {
          const it = itemsById.get(id);
          if (!it || it.kind !== "assistant-message") continue;
          const matchIdx = it.blocks.findIndex(
            (b: AssistantBlock): b is AssistantToolUseBlock =>
              b.type === "tool_use" && b.id === targetUseId,
          );
          if (matchIdx >= 0) {
            const block = it.blocks[matchIdx] as AssistantToolUseBlock;
            block.status = event.ok ? "complete" : "error";
            block.result = {
              text: typeof event.output === "string"
                ? event.output
                : Array.isArray(event.output)
                  ? (event.output as Array<{ type?: string; text?: string }>)
                      .filter((b) => b?.type === "text")
                      .map((b) => b.text ?? "")
                      .join("")
                  : "",
              isError: !event.ok,
            };
            it.updatedAt = event.tsIso;
            updated = it;
            break;
          }
        }
        if (updated) return [updateFrame(updated)];
        return [];
      }

      case "todo_write": {
        tasks = event.tasks;
        return [
          {
            kind: "tasks-update",
            "chat-id": chatId,
            body: { tasks: event.tasks },
          },
        ];
      }

      case "session_meta": {
        return [
          {
            kind: "session-state",
            "chat-id": chatId,
            body: { lifecycle: event.lifecycle },
          },
        ];
      }

      case "slash_command_set": {
        return [
          {
            kind: "slash-commands-update",
            "chat-id": chatId,
            body: { commands: event.commands },
          },
        ];
      }

      case "context_usage": {
        return [
          {
            kind: "context-usage-update",
            "chat-id": chatId,
            body: {
              percentage: event.usage.percentage,
              totalTokens: event.usage.totalTokens,
              maxTokens: event.usage.maxTokens,
              model: event.usage.model,
            },
          },
        ];
      }

      case "unknown":
      default:
        return [];
    }
  }

  return {
    get chatId() {
      return chatId;
    },
    ingest(event) {
      return ingestOne(event);
    },
    snapshot() {
      return { items: items(), tasks: [...tasks] };
    },
    reset() {
      seen.clear();
      itemsById.clear();
      itemOrder.length = 0;
      tasks = [];
    },
  };
}
