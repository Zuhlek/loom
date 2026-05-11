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
import type {
  AssistantMessageItem,
  ChatItem,
  SystemNoticeItem,
  TurnState,
  UserMessageItem,
} from "../../lib/chat-types";

interface Props {
  items: ChatItem[];
  turnState: TurnState;
}

export function MessagesTimeline({ items, turnState }: Props) {
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
          <TimelineRow key={item.id} item={item} />
        ))}
        {turnState === "running" && (
          <div className="flex gap-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            <div className="size-7" />
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full animate-pulse" style={{ background: "var(--info)" }} />
              Working…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user-message":
      return <UserRow item={item} />;
    case "assistant-message":
      return <AssistantRow item={item} />;
    case "system-notice":
      return <SystemRow item={item} />;
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
  return (
    <ChatMessage role="assistant" subtitle={formatTime(item.createdAt)} streaming={item.streaming}>
      <div className="flex flex-col gap-2">
        {item.blocks.map((block, idx) => {
          if (block.type === "text") {
            return (
              <ChatMarkdown
                key={idx}
                text={block.text}
                isStreaming={item.streaming && idx === item.blocks.length - 1}
              />
            );
          }
          if (block.type === "thinking") {
            return <ThinkingBlock key={idx} text={block.text} />;
          }
          return <ToolUseCard key={block.id} block={block} />;
        })}
        {item.blocks.length === 0 && item.streaming && (
          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Thinking…
          </span>
        )}
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
