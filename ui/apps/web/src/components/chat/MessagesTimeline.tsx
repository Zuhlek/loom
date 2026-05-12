/**
 * MessagesTimeline — renders the structured chat items emitted by
 * `ClaudeSessionBridge`. One row per item:
 *
 *   - `user-message`     → ChatMessage with the user bubble
 *   - `assistant-message` → ChatMessage; each block renders as text /
 *                          thinking / ToolUseCard
 *   - `system-notice`    → muted divider line
 *
 * Auto-scrolls to the bottom on new items unless the user has scrolled
 * away (matches t3code's MessagesTimeline behavior).
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";

import { ChatMessage } from "./ChatMessages";
import { ChatMarkdown } from "./ChatMarkdown";
import { ToolUseCard } from "./ToolUseCard";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { WorkingChip } from "./WorkingChip";
import type {
  AssistantBlock,
  AssistantMessageItem,
  ChatItem,
  PlanProposedItem,
  SystemNoticeItem,
  TurnState,
  UserMessageItem,
} from "../../lib/chat-types";

interface Props {
  items: ChatItem[];
  turnState: TurnState;
  /**
   * T-003 / US-003 (chat-streaming-fixes). Millisecond epoch when the
   * active turn entered `running`. Owned by `live-chat.tsx`'s reducer
   * (`activeTurnStartedAt` field; ADR-005). When non-null and
   * `turnState === "running"`, MessagesTimeline renders a single
   * sibling-row WorkingChip at the bottom of the scroll container
   * with a live "Working for Xs" elapsed counter (ADR-001, US-003).
   */
  activeTurnStartedAt: number | null;
  /**
   * T-003 / US-003. Called when the user clicks Accept on a
   * `plan-proposed` card. The parent route translates this into a
   * `plan-accept` ClientFrame carrying the plan item's id.
   */
  onPlanAccept?: (planId: string) => void;
  /** T-003 / US-003. Counterpart for Reject. */
  onPlanReject?: (planId: string) => void;
}

export function MessagesTimeline({
  items,
  turnState,
  activeTurnStartedAt,
  onPlanAccept,
  onPlanReject,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user has scrolled away from the bottom; only
  // auto-scroll when they're already near the floor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 64;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, turnState]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-6 flex flex-col gap-5">
        {items.length === 0 && (
          <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
            Send a message to start the conversation.
          </p>
        )}
        {items.map((item) => (
          <TimelineRow
            key={item.id}
            item={item}
            onPlanAccept={onPlanAccept}
            onPlanReject={onPlanReject}
          />
        ))}
        {turnState === "running" && activeTurnStartedAt != null && (
          <WorkingChip startedAtMs={activeTurnStartedAt} />
        )}
      </div>
    </div>
  );
}

function TimelineRow({
  item,
  onPlanAccept,
  onPlanReject,
}: {
  item: ChatItem;
  onPlanAccept?: (planId: string) => void;
  onPlanReject?: (planId: string) => void;
}) {
  switch (item.kind) {
    case "user-message":
      return <UserRow item={item} />;
    case "assistant-message":
      return <AssistantRow item={item} />;
    case "system-notice":
      return <SystemRow item={item} />;
    case "plan-proposed":
      return (
        <PlanProposedRow
          item={item}
          onAccept={onPlanAccept}
          onReject={onPlanReject}
        />
      );
  }
}

function UserRow({ item }: { item: UserMessageItem }) {
  return (
    <ChatMessage role="user" subtitle={formatTime(item.createdAt)}>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</div>
    </ChatMessage>
  );
}

function AssistantRow({ item }: { item: AssistantMessageItem }) {
  // T-003 / US-003 (chat-streaming-fixes). The legacy
  // `blocks.length === 0 && streaming` "Thinking…" placeholder was
  // removed here: WorkingChip (rendered once per turn at the bottom
  // of the timeline) now covers the "assistant is working" UX. The
  // old placeholder also contributed to bug-1's row spam because it
  // rendered per-row instead of per-turn.
  //
  // T-002 / US-002 (chat-streaming-fixes), ADR-004. Defensive filter +
  // optional chaining on every block-type discriminator. The filter
  // drops null/undefined entries (belt-and-suspenders against future
  // bridge regressions) AND ADR-004 `_placeholder: true` markers
  // backfilled by the bridge's `ensureDense` step. The streaming caret
  // index check below uses the FILTERED `arr.length` so it lands on
  // the last RENDERED block — without this it could light up an
  // invisible placeholder.
  return (
    <ChatMessage role="assistant" subtitle={formatTime(item.createdAt)} streaming={item.streaming}>
      <div className="flex flex-col gap-2">
        {item.blocks
          .filter((block): block is AssistantBlock =>
            block != null &&
            !(
              block?.type === "text" &&
              (block as { _placeholder?: boolean })._placeholder === true
            ),
          )
          .map((block, idx, arr) => {
            if (block?.type === "text") {
              return (
                <ChatMarkdown
                  key={idx}
                  text={block.text}
                  isStreaming={item.streaming && idx === arr.length - 1}
                />
              );
            }
            if (block?.type === "thinking") {
              return <ThinkingBlock key={idx} text={block.text} />;
            }
            if (block?.type === "tool_use") {
              return <ToolUseCard key={block.id} block={block} />;
            }
            // Unknown block kind — render nothing rather than throwing
            // (US-002 AC-5).
            return null;
          })}
      </div>
    </ChatMessage>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.02)" }}>
      <summary className="cursor-pointer select-none font-medium" style={{ color: "var(--muted-foreground)" }}>
        Thinking
      </summary>
      <div className="mt-2 whitespace-pre-wrap leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
        {text}
      </div>
    </details>
  );
}

/**
 * T-003 / US-003 AC2. Render the chat-level Proposed-Plan card. Per
 * ADR-001 the card is shown unconditionally whenever a `plan-proposed`
 * item exists — there is no hiding based on loom's pipeline phase.
 */
function PlanProposedRow({
  item,
  onAccept,
  onReject,
}: {
  item: PlanProposedItem;
  onAccept?: (planId: string) => void;
  onReject?: (planId: string) => void;
}) {
  return (
    <ProposedPlanCard
      item={item}
      onAccept={() => onAccept?.(item.id)}
      onReject={() => onReject?.(item.id)}
    />
  );
}

function SystemRow({ item }: { item: SystemNoticeItem }) {
  return (
    <div
      className={clsx("text-[11px] text-center font-mono px-2 py-1 rounded")}
      style={{
        color: item.level === "error" ? "var(--destructive-foreground)" : "var(--muted-foreground)",
        background: item.level === "error" ? "rgba(239,68,68,0.08)" : "transparent",
      }}
    >
      {item.text}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
