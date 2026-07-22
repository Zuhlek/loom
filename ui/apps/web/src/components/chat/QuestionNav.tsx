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
import type { UserMessageImage } from "../../lib/chat-types";
import { imageSrc } from "../../lib/chat-images";
import { ImageThumb } from "./ImageThumb";

interface Props {
  rows: TimelineRow[];
  /** Chat id — needed to build `/chat-image` read-back URLs for thumbnails. */
  chatId: string;
  /** Id of the user message currently in view, or null. */
  activeId: string | null;
  /** Scroll the timeline to the user message with this id. */
  onJump: (id: string) => void;
  /**
   * Open the shared image lightbox at the given message's `localIdx`-th
   * resolvable image. `localIdx` counts only images that resolve to a
   * src, matching `collectUserImages` in `lib/chat-images.ts`.
   */
  onOpenImage?: (messageId: string, localIdx: number) => void;
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

export function QuestionNav({ rows, chatId, activeId, onJump, onOpenImage }: Props) {
  const questions = useMemo(
    () =>
      rows
        .filter((r): r is Extract<TimelineRow, { kind: "user" }> => r.kind === "user")
        .map((r) => ({
          id: r.item.id,
          label: firstSentence(r.item.text),
          // Only images that resolve to a src, so the click index lines up
          // with `collectUserImages` in `lib/chat-images.ts` (which counts
          // resolvable images).
          images: (r.item.images ?? ([] as UserMessageImage[]))
            .map((img) => ({ src: imageSrc(img, chatId), filename: img.filename }))
            .filter(
              (e): e is { src: string; filename: string | undefined } => e.src !== undefined,
            ),
        })),
    [rows, chatId],
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
              <div
                key={q.id}
                data-active={active || undefined}
                className="border-l-2"
                style={{ borderColor: active ? "var(--primary)" : "transparent" }}
              >
                <button
                  type="button"
                  onClick={() => onJump(q.id)}
                  title={q.label}
                  className={clsx(
                    "block w-full px-3 py-1.5 text-left text-xs leading-snug transition-colors",
                    "hover:bg-[var(--accent)]",
                  )}
                  style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}
                >
                  <span className="line-clamp-2">{q.label}</span>
                </button>
                {q.images.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                    {q.images.map((img, i) => (
                      <ImageThumb
                        key={i}
                        src={img.src}
                        alt={img.filename ?? ""}
                        title={img.filename ?? ""}
                        onClick={onOpenImage ? () => onOpenImage(q.id, i) : undefined}
                        className="size-8"
                        ariaLabel={`Open image ${i + 1} from this question`}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
