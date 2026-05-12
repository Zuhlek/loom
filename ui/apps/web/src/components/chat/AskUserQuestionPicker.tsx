/**
 * AskUserQuestionPicker — renders a `PendingQuestion` payload.
 *
 * Per US-001 / T-002 the picker supports:
 *   - Single-select (default; rendered as radio rows).
 *   - Multi-select (`multiSelect: true`; rendered as checkbox rows;
 *     selected ids accumulate in a `string[]` until submit).
 *   - "Other" free-text escape hatch — a final selectable row with
 *     id `"__freeform__"` that reveals an inline text input when
 *     picked. The typed body rides alongside the selected ids on
 *     submit.
 *
 * Submit payload shape: `{ answers: string[]; otherText?: string }`
 * exactly matches the wire `question-response.body` declared in
 * `chat-types.ts` so live-chat can forward it verbatim.
 *
 * Two usage modes:
 *   1. Live (the SDK path) — caller passes a `PendingQuestion` via
 *      the `question` prop. `onSubmit` carries the structured payload.
 *   2. Demo (legacy `routes/chat.tsx`) — caller passes loose
 *      `question`/`options` strings. `onSubmit` is optional in this
 *      mode so the demo route still renders without wiring a handler.
 */
import { useState } from "react";

import type { PendingQuestion } from "../../lib/chat-types";

export type AskOption = {
  id: string;
  label: string;
  description?: string;
  /** Legacy demo prop — kept for `routes/chat.tsx`'s rich rows. */
  detail?: string;
  /** Legacy demo prop — size+risk badge, e.g. "S, Low" or "M, Med". */
  badge?: string;
};

export interface AskUserQuestionPickerProps {
  /**
   * Live mode: pass the full PendingQuestion payload. Takes precedence
   * over the loose `question` / `options` fallback props.
   */
  pending?: PendingQuestion;
  /** Legacy / demo mode: loose question string. */
  question?: string;
  /** Legacy / demo mode: loose options list. */
  options?: AskOption[];
  /**
   * Submit payload mirrors the wire `question-response.body`:
   *   answers: string[]; otherText?: string;
   * The sentinel `"__freeform__"` is included in `answers` when the
   * user picks the "Other" row.
   */
  onSubmit?: (payload: { answers: string[]; otherText?: string }) => void;
  onSkip?: () => void;
}

const FREEFORM_ID = "__freeform__";

export function AskUserQuestionPicker(props: AskUserQuestionPickerProps) {
  const question = props.pending?.question ?? props.question ?? "";
  const options: AskOption[] =
    (props.pending?.options as AskOption[] | undefined) ?? props.options ?? [];
  const multiSelect = props.pending?.multiSelect === true;

  // Selected ids live in an array regardless of single/multi so the
  // submit path has one shape. Single-select keeps length ≤ 1.
  const [selected, setSelected] = useState<string[]>([]);
  const [otherText, setOtherText] = useState<string>("");

  const isSelected = (id: string): boolean => selected.includes(id);
  const showFreeformInput = isSelected(FREEFORM_ID);

  const toggle = (id: string): void => {
    if (multiSelect) {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    } else {
      setSelected([id]);
    }
  };

  const submit = (): void => {
    if (selected.length === 0) return;
    const payload: { answers: string[]; otherText?: string } = {
      answers: selected,
    };
    if (selected.includes(FREEFORM_ID) && otherText.trim() !== "") {
      payload.otherText = otherText;
    }
    props.onSubmit?.(payload);
  };

  return (
    <div
      className="ml-10 rounded-xl border-2 overflow-hidden"
      style={{ borderColor: "var(--info)", background: "rgba(59,130,246,0.04)" }}
    >
      <div
        className="px-4 py-3 flex items-center gap-2.5 border-b"
        style={{ borderColor: "rgba(59,130,246,0.25)" }}
      >
        <div
          className="size-6 rounded-md grid place-items-center shrink-0"
          style={{ background: "rgba(59,130,246,0.18)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="size-3.5"
            style={{ color: "var(--info-foreground)" }}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" />
          </svg>
        </div>
        <div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{ background: "rgba(59,130,246,0.18)", color: "var(--info-foreground)" }}
          >
            AskUserQuestion
          </span>
          {multiSelect && (
            <span
              className="text-[9px] font-mono px-1 rounded shrink-0"
              style={{ background: "rgba(59,130,246,0.12)", color: "var(--muted-foreground)" }}
            >
              multi-select
            </span>
          )}
          <p className="text-sm font-medium">{question}</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {options.map((opt) => {
          const sel = isSelected(opt.id);
          const inputType = multiSelect ? "checkbox" : "radio";
          return (
            <label
              key={opt.id}
              onClick={() => toggle(opt.id)}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors"
              style={
                sel
                  ? {
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: "var(--primary)",
                      background: "rgba(59,130,246,0.04)",
                    }
                  : { borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }
              }
            >
              {/* Hidden semantic input — keeps the markup screen-reader friendly. */}
              <input
                type={inputType}
                checked={sel}
                readOnly
                tabIndex={-1}
                className="sr-only"
                aria-label={opt.label}
              />
              <div
                className="mt-0.5 size-3.5 grid place-items-center"
                style={{
                  borderWidth: 2,
                  borderStyle: "solid",
                  borderColor: sel ? "var(--primary)" : "var(--border)",
                  borderRadius: multiSelect ? 3 : "999px",
                }}
              >
                {sel && (
                  <div
                    className="size-1.5"
                    style={{
                      background: "var(--primary)",
                      borderRadius: multiSelect ? 1 : "999px",
                    }}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{opt.label}</span>
                  {opt.badge && (
                    <span
                      className="text-[9px] font-mono px-1 rounded"
                      style={{ background: "rgba(16,185,129,0.15)", color: "var(--success-foreground)" }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </div>
                {(opt.description ?? opt.detail) && (
                  <p
                    className="text-[11px] mt-0.5"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {opt.description ?? opt.detail}
                  </p>
                )}
              </div>
            </label>
          );
        })}

        {/* "Other" — the freeform escape hatch. Always offered alongside
            the parsed options; selecting it reveals an inline text input. */}
        <label
          key={FREEFORM_ID}
          onClick={() => toggle(FREEFORM_ID)}
          className="flex items-start gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors"
          style={
            isSelected(FREEFORM_ID)
              ? {
                  borderWidth: 2,
                  borderStyle: "solid",
                  borderColor: "var(--primary)",
                  background: "rgba(59,130,246,0.04)",
                }
              : { borderWidth: 1, borderStyle: "dashed", borderColor: "var(--border)" }
          }
        >
          <input
            type={multiSelect ? "checkbox" : "radio"}
            checked={isSelected(FREEFORM_ID)}
            readOnly
            tabIndex={-1}
            className="sr-only"
            aria-label="Other"
          />
          <div
            className="mt-0.5 size-3.5 grid place-items-center"
            style={{
              borderWidth: 2,
              borderStyle: "solid",
              borderColor: isSelected(FREEFORM_ID) ? "var(--primary)" : "var(--border)",
              borderRadius: multiSelect ? 3 : "999px",
            }}
          >
            {isSelected(FREEFORM_ID) && (
              <div
                className="size-1.5"
                style={{
                  background: "var(--primary)",
                  borderRadius: multiSelect ? 1 : "999px",
                }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">Other (write your own answer)</div>
          </div>
        </label>
      </div>

      {showFreeformInput && (
        <div className="px-4 pb-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <textarea
            rows={2}
            placeholder="Type your answer..."
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none resize-none"
            style={{ borderColor: "var(--border)" }}
            data-testid="ask-user-question-other-input"
          />
        </div>
      )}

      <div className="px-4 pb-4 pt-2 border-t flex items-center justify-end gap-2" style={{ borderColor: "var(--border)" }}>
        {props.onSkip && (
          <button
            onClick={props.onSkip}
            className="text-[11px] px-2 py-1 rounded hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Skip
          </button>
        )}
        <button
          onClick={submit}
          disabled={selected.length === 0}
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm disabled:opacity-50"
          style={{ background: "var(--primary)" }}
        >
          Submit answer
        </button>
      </div>
    </div>
  );
}
