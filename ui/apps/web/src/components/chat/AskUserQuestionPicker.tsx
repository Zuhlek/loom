import { useState } from "react";

export type AskOption = {
  id: string;
  label: string;
  detail?: string;
  /** size+risk badge, e.g. "S, Low" or "M, Med" */
  badge?: string;
};

export interface AskUserQuestionPickerProps {
  question: string;
  options: AskOption[];
  initial?: string;
  onSubmit?: (id: string, freeform?: string) => void;
  onSkip?: () => void;
}

export function AskUserQuestionPicker({ question, options, initial, onSubmit, onSkip }: AskUserQuestionPickerProps) {
  const [selected, setSelected] = useState(initial ?? options[0]?.id);
  const [freeform, setFreeform] = useState("");

  return (
    <div className="ml-10 rounded-xl border-2 overflow-hidden" style={{ borderColor: "var(--info)", background: "rgba(59,130,246,0.04)" }}>
      <div className="px-4 py-3 flex items-start gap-2.5 border-b" style={{ borderColor: "rgba(59,130,246,0.25)" }}>
        <div className="size-6 rounded-md grid place-items-center mt-0.5" style={{ background: "rgba(59,130,246,0.18)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--info-foreground)" }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.18)", color: "var(--info-foreground)" }}>
              AskUserQuestion
            </span>
          </div>
          <p className="text-sm font-medium mt-0.5">{question}</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {options.map((opt) => {
          const sel = selected === opt.id;
          return (
            <label
              key={opt.id}
              onClick={() => setSelected(opt.id)}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors"
              style={
                sel
                  ? { borderWidth: 2, borderStyle: "solid", borderColor: "var(--primary)", background: "rgba(59,130,246,0.04)" }
                  : { borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }
              }
            >
              <div className="mt-0.5 size-3.5 rounded-full grid place-items-center" style={{ borderWidth: 2, borderStyle: "solid", borderColor: sel ? "var(--primary)" : "var(--border)" }}>
                {sel && <div className="size-1.5 rounded-full" style={{ background: "var(--primary)" }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{opt.label}</span>
                  {opt.badge && (
                    <span className="text-[9px] font-mono px-1 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "var(--success-foreground)" }}>
                      {opt.badge}
                    </span>
                  )}
                </div>
                {opt.detail && (
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                    {opt.detail}
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
        <label className="text-[10px] uppercase tracking-wide font-medium" style={{ color: "var(--muted-foreground)" }}>
          Or push back / write a custom answer
        </label>
        <textarea
          rows={2}
          placeholder="e.g. 'mimic t3code entirely — analyse how it does it'..."
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          className="mt-1 w-full px-2.5 py-1.5 rounded-md border bg-white text-sm outline-none resize-none"
          style={{ borderColor: "var(--border)" }}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onSkip} className="text-[11px] px-2 py-1 rounded hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
            Skip phase
          </button>
          <button
            onClick={() => onSubmit?.(selected!, freeform || undefined)}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm"
            style={{ background: "var(--primary)" }}
          >
            Submit answer
          </button>
        </div>
      </div>
    </div>
  );
}
