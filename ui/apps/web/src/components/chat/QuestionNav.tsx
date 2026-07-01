/**
 * QuestionNav — a "table of contents" for the chat: an always-visible
 * left column inside the message area that lists the first sentence of
 * every user-posed question. Clicking an entry scrolls the timeline to
 * that message; the entry whose message is currently on screen is
 * highlighted (driven by `activeId`, computed by MessagesTimeline via
 * an IntersectionObserver).
 *
 * Purely presentational — it reads the same `TimelineRow[]` the
 * timeline already derives, so no extra data plumbing.
 */
import { useMemo } from "react";
import clsx from "clsx";

import type { TimelineRow } from "../../lib/timeline-rows";

interface Props {
  rows: TimelineRow[];
  /** Id of the user message currently in view, or null. */
  activeId: string | null;
  /** Scroll the timeline to the user message with this id. */
  onJump: (id: string) => void;
}

/**
 * Reduce a (possibly multi-paragraph) question to a single short label:
 * collapse whitespace, keep up to the first sentence terminator, and
 * cap the length with an ellipsis so the nav stays one-or-two lines.
 */
export function firstSentence(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  if (!flat) return "(empty message)";
  const match = flat.match(/^.*?[.!?](?=\s|$)/);
  let out = match ? match[0] : flat;
  if (out.length > 80) out = `${out.slice(0, 79).trimEnd()}…`;
  return out;
}

export function QuestionNav({ rows, activeId, onJump }: Props) {
  const questions = useMemo(
    () =>
      rows
        .filter((r): r is Extract<TimelineRow, { kind: "user" }> => r.kind === "user")
        .map((r) => ({ id: r.item.id, label: firstSentence(r.item.text) })),
    [rows],
  );

  return (
    <aside
      className="flex w-56 shrink-0 flex-col overflow-y-auto border-r"
      style={{ borderColor: "var(--border)" }}
      aria-label="Questions in this chat"
      data-testid="question-nav"
    >
      <div
        className="sticky top-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wide"
        style={{ color: "var(--muted-foreground)", background: "var(--background)" }}
      >
        Questions
      </div>
      {questions.length === 0 ? (
        <p className="px-3 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
          No questions yet.
        </p>
      ) : (
        <nav className="flex flex-col pb-4">
          {questions.map((q) => {
            const active = q.id === activeId;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onJump(q.id)}
                title={q.label}
                data-active={active || undefined}
                className={clsx(
                  "border-l-2 px-3 py-1.5 text-left text-xs leading-snug transition-colors",
                  "hover:bg-[var(--accent)]",
                )}
                style={{
                  borderColor: active ? "var(--primary)" : "transparent",
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                }}
              >
                <span className="line-clamp-2">{q.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
