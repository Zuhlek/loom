/**
 * Derive the visual rows the MessagesTimeline renders, from the raw
 * `ChatItem[]` the bridge emits. The key behaviour: consecutive
 * assistant-messages that contain ONLY tool_use blocks (no text,
 * no thinking) collapse into a single "work-group" row with compact
 * one-line summaries — mirrors t3code's WorkGroupSection grouping.
 *
 * Pure: no React, no DOM. Exercised by `test/timeline-rows.test.ts`.
 */
import type {
  AssistantMessageItem,
  AssistantToolUseBlock,
  ChatItem,
  PlanProposedItem,
  SystemNoticeItem,
  UserMessageItem,
} from "./chat-types";

export type TimelineRow =
  | { kind: "user"; id: string; item: UserMessageItem }
  | { kind: "assistant"; id: string; item: AssistantMessageItem }
  | {
      kind: "work-group";
      /** Stable id derived from the first message in the group. */
      id: string;
      /**
       * Flattened list of every tool_use block in the group, in original
       * order. Each entry knows which assistant message it came from so
       * the renderer can key + look up results.
       */
      tools: Array<{
        block: AssistantToolUseBlock;
        sourceMessageId: string;
      }>;
    }
  | { kind: "plan-proposed"; id: string; item: PlanProposedItem }
  | { kind: "system"; id: string; item: SystemNoticeItem };

/**
 * Classify an assistant-message for timeline-row dispatch:
 *
 *   - `"work-group"` : tool-only — at least one tool_use block, and no
 *                      meaningful text/thinking. Streaming counts the
 *                      same as finalized so a new tool call is born
 *                      *inside* the work-group instead of flashing as
 *                      a standalone row before being reclassified.
 *   - `"skip"`       : empty + streaming. The SDK message exists but
 *                      no blocks have arrived yet; the global
 *                      WorkingChip covers "Claude is working" so we
 *                      don't render a placeholder row that flickers
 *                      between empty and tool-only.
 *   - `"assistant"`  : everything else — has real text/thinking, or
 *                      is empty + finalized (a defensive fallback for
 *                      malformed messages).
 *
 * The key behavioural change vs. the earlier `isToolOnlyAssistantMessage`
 * helper: we no longer exclude streaming messages from grouping. The
 * flicker the user reported (tool call appears as its own Claude row,
 * then merges into the group above on finalize) came directly from
 * that exclusion.
 */
export function classifyAssistantMessage(
  item: AssistantMessageItem,
): "work-group" | "assistant" | "skip" {
  let sawTool = false;
  let sawMeaningfulNonTool = false;
  for (const block of item.blocks) {
    if (!block) continue;
    if (block.type === "tool_use") {
      sawTool = true;
      continue;
    }
    if (block.type === "text") {
      if ((block as { _placeholder?: boolean })._placeholder === true) continue;
      if (block.text.trim().length === 0) continue;
      sawMeaningfulNonTool = true;
      continue;
    }
    if (block.type === "thinking") {
      if (block.text.trim().length === 0) continue;
      sawMeaningfulNonTool = true;
    }
  }
  if (sawMeaningfulNonTool) return "assistant";
  if (sawTool) return "work-group";
  return item.streaming ? "skip" : "assistant";
}

/**
 * The bridge's `handleSessionFailure` appends a system-notice with the
 * exact prefix `Session error:` (level `"error"`) on every SDK loop
 * failure. We drop these from the visible timeline because the global
 * Snackbar already surfaces the same `lastError`. Anything else with
 * level `"error"` (mode-change failures, recovery-exhausted message,
 * etc.) keeps rendering as a SystemRow so the audit trail is intact.
 */
function isSessionErrorNotice(item: SystemNoticeItem): boolean {
  return item.level === "error" && item.text.startsWith("Session error:");
}

export function deriveTimelineRows(items: ReadonlyArray<ChatItem>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (item.kind === "user-message") {
      rows.push({ kind: "user", id: item.id, item });
      i += 1;
      continue;
    }
    if (item.kind === "plan-proposed") {
      rows.push({ kind: "plan-proposed", id: item.id, item });
      i += 1;
      continue;
    }
    if (item.kind === "system-notice") {
      // Drop "Session error: ..." notices from the visible timeline —
      // the bridge appends those for audit, but the global Snackbar
      // already surfaces the same `lastError` to the user. Rendering
      // both produces the redundant top + bottom display the user
      // flagged. Other system-notices (mode-change failures, recovery
      // exhaustion, info messages) keep rendering normally.
      if (isSessionErrorNotice(item)) {
        i += 1;
        continue;
      }
      rows.push({ kind: "system", id: item.id, item });
      i += 1;
      continue;
    }
    if (item.kind === "assistant-message") {
      const cls = classifyAssistantMessage(item);
      if (cls === "skip") {
        i += 1;
        continue;
      }
      if (cls === "assistant") {
        rows.push({ kind: "assistant", id: item.id, item });
        i += 1;
        continue;
      }
      // "work-group": group this + any following assistant-messages
      // that also classify as work-group OR skip. Letting `"skip"`
      // be absorbed prevents an empty streaming placeholder from
      // splitting an otherwise-contiguous run of tool calls.
      const tools: Array<{ block: AssistantToolUseBlock; sourceMessageId: string }> = [];
      const groupStartId = item.id;
      let j = i;
      while (j < items.length) {
        const next = items[j]!;
        if (next.kind !== "assistant-message") break;
        const nextCls = classifyAssistantMessage(next);
        if (nextCls === "assistant") break;
        for (const block of next.blocks) {
          if (block?.type === "tool_use") {
            tools.push({ block, sourceMessageId: next.id });
          }
        }
        j += 1;
      }
      rows.push({
        kind: "work-group",
        id: `work-group:${groupStartId}`,
        tools,
      });
      i = j;
      continue;
    }
    // Exhaustive fallthrough: unknown item kind — skip.
    i += 1;
  }
  return rows;
}
