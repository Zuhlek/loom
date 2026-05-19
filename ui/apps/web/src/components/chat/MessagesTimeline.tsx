/**
 * MessagesTimeline — renders the structured chat items emitted by
 * `ClaudeSessionBridge`. One row per item:
 *
 *   - `user-message`     → right-aligned bubble (user-bg token)
 *   - `assistant-message` → left-aligned: text blocks grouped into
 *                          WhatsApp-style bubble(s); tool_use cards
 *                          and `<details>` thinking blocks render
 *                          outside the bubble.
 *   - `system-notice`    → muted divider line
 *
 * Auto-scrolls to the bottom on new items unless the user has scrolled
 * away (matches t3code's MessagesTimeline behavior).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

import { ChatMarkdown } from "./ChatMarkdown";
import { ToolUseCard } from "./ToolUseCard";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { WorkingChip } from "./WorkingChip";
import { WorkGroupCard } from "./WorkGroupCard";
import { deriveTimelineRows, type TimelineRow } from "../../lib/timeline-rows";
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
   * Millisecond epoch when the active turn entered `running`. Owned
   * by `live-chat.tsx`'s reducer (`activeTurnStartedAt` field). When
   * non-null and `turnState === "running"`, MessagesTimeline renders
   * a single sibling-row WorkingChip at the bottom of the scroll
   * container with a live "Working for Xs" elapsed counter.
   */
  activeTurnStartedAt: number | null;
  /**
   * Called when the user clicks Accept on a `plan-proposed` card.
   * The parent route translates this into a `plan-accept`
   * ClientFrame carrying the plan item's id.
   */
  onPlanAccept?: (planId: string) => void;
  /** Counterpart for Reject. */
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
  const innerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  // Mirror of `stickToBottomRef` exposed as state so the floating
  // "jump to bottom" chevron can react to scroll position. We keep
  // the ref too because the auto-scroll effect needs to read the
  // latest value without re-running on every scroll tick.
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // On open, the timeline must land at the bottom — not the top — so
  // the user sees the most recent messages without scrolling. We do
  // this synchronously before paint (useLayoutEffect) AND on the next
  // frame, because markdown / code blocks can grow the scrollHeight
  // after the initial layout pass.
  useLayoutEffect(() => {
    scrollToBottom("auto");
    const raf = requestAnimationFrame(() => scrollToBottom("auto"));
    return () => cancelAnimationFrame(raf);
    // Mount-only — subsequent updates are handled by the items effect
    // and the ResizeObserver below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track stick-to-bottom by USER INTENT, not scroll position.
  //
  // Earlier this read `distance < 64` on every scroll event and wrote
  // the result into `stickToBottomRef`. That created a race: a
  // programmatic `scrollToBottom()` writes `scrollTop = scrollHeight`,
  // but the browser fires the resulting scroll event asynchronously.
  // Between the write and the handler, late-rendered content (markdown
  // code blocks, syntax highlighting, images) can grow `scrollHeight`.
  // The handler then sees `scrollTop` against the NEW `scrollHeight`,
  // computes a non-zero distance, and incorrectly concludes the user
  // had scrolled away — disabling auto-stick for the rest of the
  // session. Symptom: long chats with markdown never land at the
  // bottom even on hard refresh.
  //
  // Fix: only an UPWARD scroll delta from a position that is no longer
  // at the bottom counts as "the user scrolled away". Programmatic
  // scrolls only ever move scrollTop downward (or leave it pinned),
  // so they cannot trip this. Coming back to the bottom by any means
  // re-arms auto-stick.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastScrollTop = el.scrollTop;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < 64;
      const movedUp = el.scrollTop < lastScrollTop;
      if (movedUp && !atBottom) {
        stickToBottomRef.current = false;
      } else if (atBottom) {
        stickToBottomRef.current = true;
      }
      setIsAtBottom(atBottom);
      lastScrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [items, turnState, scrollToBottom]);

  // Re-pin to bottom when the inner content grows (late-rendered
  // markdown, images, tool cards). Without this, an initial scroll-
  // to-bottom lands above the floor as soon as more layout settles,
  // and the user sees the "opened at top" symptom on slow renders.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom("auto");
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // Group consecutive tool-only assistant messages into one work-group
  // row — keeps the timeline readable when Claude bursts through a
  // sequence of Bash / Glob / Grep calls between meaningful prose.
  const rows = useMemo(() => deriveTimelineRows(items), [items]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div ref={innerRef} className="mx-auto max-w-3xl px-5 py-6 flex flex-col gap-4">
          {items.length === 0 && (
            <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
              Send a message to start the conversation.
            </p>
          )}
          {rows.map((row) => (
            <TimelineRowView
              key={row.id}
              row={row}
              onPlanAccept={onPlanAccept}
              onPlanReject={onPlanReject}
            />
          ))}
          {turnState === "running" && activeTurnStartedAt != null && (
            <WorkingChip startedAtMs={activeTurnStartedAt} />
          )}
        </div>
      </div>
      <JumpToBottomButton
        visible={!isAtBottom}
        onClick={() => scrollToBottom("smooth")}
      />
    </div>
  );
}

/**
 * Floating chevron button shown when the user has scrolled up from
 * the bottom of the timeline. One-tap "jump to latest" — mirrors the
 * affordance every modern messenger ships.
 */
function JumpToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest message"
      title="Scroll to latest"
      data-testid="jump-to-bottom"
      className={clsx(
        "absolute right-5 bottom-5 z-10 flex h-9 w-9 items-center justify-center",
        "rounded-full border shadow-md transition-all duration-150",
        "hover:translate-y-[-1px] active:translate-y-0",
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
      style={{
        background: "var(--background)",
        borderColor: "var(--border)",
        color: "var(--foreground)",
      }}
      tabIndex={visible ? 0 : -1}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

function TimelineRowView({
  row,
  onPlanAccept,
  onPlanReject,
}: {
  row: TimelineRow;
  onPlanAccept?: (planId: string) => void;
  onPlanReject?: (planId: string) => void;
}) {
  switch (row.kind) {
    case "user":
      return <UserRow item={row.item} />;
    case "assistant":
      return <AssistantRow item={row.item} />;
    case "work-group":
      return <WorkGroupCard tools={row.tools} />;
    case "system":
      return <SystemRow item={row.item} />;
    case "plan-proposed":
      return (
        <PlanProposedRow
          item={row.item}
          onAccept={onPlanAccept}
          onReject={onPlanReject}
        />
      );
  }
}

function UserRow({ item }: { item: UserMessageItem }) {
  // Right-aligned chat bubble. No avatar — the alignment alone signals
  // role (mirrors t3code's UserTimelineRow). The asymmetric corner
  // radius (`rounded-br-sm`) is the visual tail pointing at the user.
  // The bubble's background is the loom-blue-tinted user token so it
  // visually distinguishes the user's turn from the agent's bubble.
  //
  // When `item.images?.length` is non-zero render a thumbnail row
  // above the text. Each thumbnail is an inline `data:` URL —
  // mirrors `ToolResultMedia.tsx`'s transport (no blob URLs, no
  // server route).
  const images = item.images ?? [];
  const hasImages = images.length > 0;
  return (
    <div className="flex justify-end">
      <div
        className="group relative max-w-[85%] rounded-2xl rounded-br-sm border px-4 py-2.5"
        style={{
          borderColor: "var(--bubble-user-border)",
          background: "var(--bubble-user-bg)",
          color: "var(--bubble-user-fg)",
        }}
        data-testid="user-message-bubble"
      >
        {hasImages && (
          <div
            className="mb-2 flex flex-wrap gap-1.5"
            data-testid="user-message-images"
          >
            {item.images?.map((img, idx) => (
              <img
                key={idx}
                src={`data:${img.mediaType};base64,${img.dataB64}`}
                alt={img.filename ?? ""}
                title={img.filename ?? ""}
                className="h-24 w-24 rounded-md object-cover"
              />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {item.text}
        </div>
        <p
          className="mt-1 text-right text-[10px] opacity-70"
        >
          {formatTime(item.createdAt)}
        </p>
      </div>
    </div>
  );
}

function AssistantRow({ item }: { item: AssistantMessageItem }) {
  // WorkingChip (rendered once per turn at the bottom of the
  // timeline) covers the "assistant is working" UX, so no per-row
  // "Thinking…" placeholder is rendered here.
  //
  // Defensive filter + optional chaining on every block-type
  // discriminator. The filter drops null/undefined entries
  // (belt-and-suspenders against future bridge regressions) AND
  // `_placeholder: true` markers backfilled by the bridge's
  // `ensureDense` step. The streaming caret index check below uses
  // the FILTERED `arr.length` so it lands on the last RENDERED
  // block — without this it could light up an invisible placeholder.
  //
  // WhatsApp-style bubble: consecutive `text` blocks render together
  // inside a single AssistantTextBubble; `tool_use` and `thinking`
  // blocks render unwrapped so cards/details keep their card-style
  // chrome. We walk the filtered blocks once and group adjacent text
  // runs so multi-block streams still produce one bubble rather than
  // a stack of tiny ones. The avatar and "Claude" label that the old
  // ChatMessage wrapper drew are gone — alignment alone signals role
  // (matching the user-bubble side), and the createdAt timestamp lives
  // inside the last text bubble bottom-right (WhatsApp-style).
  const visibleBlocks = item.blocks.filter(
    (block): block is AssistantBlock =>
      block != null &&
      !(
        block?.type === "text" &&
        (block as { _placeholder?: boolean })._placeholder === true
      ),
  );
  const lastVisibleIdx = visibleBlocks.length - 1;
  let lastTextIdx = -1;
  for (let i = visibleBlocks.length - 1; i >= 0; i -= 1) {
    if (visibleBlocks[i]?.type === "text") {
      lastTextIdx = i;
      break;
    }
  }

  const rendered: ReactNode[] = [];
  let textRun: { idx: number; text: string }[] = [];

  const flushTextRun = (key: string) => {
    if (textRun.length === 0) return;
    const runEntries = textRun;
    const runEndsAtLastText = runEntries[runEntries.length - 1]!.idx === lastTextIdx;
    const isLastRunInStream = runEntries[runEntries.length - 1]!.idx === lastVisibleIdx;
    rendered.push(
      <AssistantTextBubble
        key={key}
        timestamp={runEndsAtLastText ? formatTime(item.createdAt) : null}
      >
        {runEntries.map((entry, i) => (
          <ChatMarkdown
            key={i}
            text={entry.text}
            isStreaming={item.streaming && isLastRunInStream && i === runEntries.length - 1}
          />
        ))}
      </AssistantTextBubble>,
    );
    textRun = [];
  };

  visibleBlocks.forEach((block, idx) => {
    if (block?.type === "text") {
      textRun.push({ idx, text: block.text });
      return;
    }
    flushTextRun(`text-${idx}`);
    if (block?.type === "thinking") {
      rendered.push(<ThinkingBlock key={`think-${idx}`} text={block.text} />);
      return;
    }
    if (block?.type === "tool_use") {
      rendered.push(<ToolUseCard key={block.id} block={block} />);
      return;
    }
    // Unknown block kind — render nothing rather than throwing.
  });
  flushTextRun(`text-tail`);

  // If the assistant emitted only tool_use / thinking blocks (no text
  // yet — common while streaming starts), don't render an empty time
  // stamp; the tool cards and WorkingChip carry the "still working"
  // signal on their own.
  return (
    <div className="flex flex-col items-start gap-2">{rendered}</div>
  );
}

/**
 * Plain-text wrapper for the assistant's text answers. No bubble chrome —
 * answers render as bare text spanning the full width of the
 * MessagesTimeline column, so the left edge aligns with the composer's
 * left border and the right edge aligns with the composer's right
 * border. `w-full` explicitly stretches the cross-axis inside the
 * parent's flex `items-start` container (tool_use cards and
 * <Thinking> details still render at their natural width). The
 * `timestamp` (when provided — last text bubble of the message) sits
 * bottom-right.
 */
function AssistantTextBubble({
  children,
  timestamp,
}: {
  children: ReactNode;
  timestamp: string | null;
}) {
  return (
    <div className="w-full" data-testid="assistant-message-bubble">
      {children}
      {timestamp && (
        <p className="mt-1 text-right text-[10px] opacity-60">{timestamp}</p>
      )}
    </div>
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
 * Render the chat-level Proposed-Plan card. The card is shown
 * unconditionally whenever a `plan-proposed` item exists — there is
 * no hiding based on loom's pipeline phase.
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
