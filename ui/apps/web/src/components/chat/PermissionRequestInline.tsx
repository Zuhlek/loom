import { InlineEditDiff } from "./InlineEditDiff";

export type EditDetection =
  | { kind: "edit"; filePath: string; oldString: string; newString: string }
  | { kind: "write"; filePath: string; content: string }
  | null;

/**
 * Shape-first detection over the args record. Edit signature wins over
 * Write when both shapes are present. Prompt text is reserved as a
 * tie-breaker for future ambiguous-superset payloads (MultiEdit /
 * NotebookEdit); today it's not consulted because the Edit / Write
 * shapes are unambiguous.
 */
export function detectEditToolArgs(
  args: Record<string, unknown>,
  _prompt: string,
): EditDetection {
  const filePath = args.file_path;
  if (typeof filePath !== "string") return null;
  const oldString = args.old_string;
  const newString = args.new_string;
  if (typeof oldString === "string" && typeof newString === "string") {
    return { kind: "edit", filePath, oldString, newString };
  }
  const content = args.content;
  if (typeof content === "string") {
    return { kind: "write", filePath, content };
  }
  return null;
}

export interface PermissionRequestInlineProps {
  prompt: string;
  args: Record<string, string>;
  reason?: string;
  onCancelTurn?: () => void;
  onDecline?: () => void;
  onAlwaysAllow?: () => void;
  onApproveOnce?: () => void;
}

export function PermissionRequestInline({ prompt, args, reason, onCancelTurn, onDecline, onAlwaysAllow, onApproveOnce }: PermissionRequestInlineProps) {
  // Drop args entries whose value duplicates the reason badge below (e.g. Bash's
  // `description` arg mirrors pp.description). Keeps args intact for tools that
  // don't have this overlap.
  const visibleArgs = reason ? Object.entries(args).filter(([, v]) => v !== reason) : Object.entries(args);
  const detected = detectEditToolArgs(args, prompt);

  return (
    <div className="ml-10 rounded-xl border-2 overflow-hidden" style={{ borderColor: "var(--warning)", background: "rgba(245,158,11,0.04)" }}>
      <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(245,158,11,0.25)" }}>
        <div className="size-6 rounded-md grid place-items-center shrink-0" style={{ background: "rgba(245,158,11,0.18)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--warning-foreground)" }}>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        </div>
        <div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(245,158,11,0.18)", color: "var(--warning-foreground)" }}>
            PermissionRequest
          </span>
          <p className="text-sm font-medium">{prompt}</p>
          {reason && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] min-w-0"
              style={{ background: "rgba(59,130,246,0.06)", color: "var(--info-foreground)" }}
              title={reason}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3 shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="truncate">{reason}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {detected ? (
          detected.kind === "edit" ? (
            <InlineEditDiff
              mode="edit"
              filePath={detected.filePath}
              oldString={detected.oldString}
              newString={detected.newString}
            />
          ) : (
            <InlineEditDiff
              mode="write"
              filePath={detected.filePath}
              content={detected.content}
            />
          )
        ) : (
          visibleArgs.length > 0 && (
            <pre className="font-mono text-[11px] px-3 py-2 rounded-md border overflow-auto max-h-[40vh]" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <code>
                {visibleArgs.map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: "var(--info-foreground)" }}>{k}</span>: {v}
                  </div>
                ))}
              </code>
            </pre>
          )
        )}
      </div>

      <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(255,255,255,0.4)" }}>
        <button onClick={onCancelTurn} className="px-2.5 py-1.5 rounded-md text-xs font-medium hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
          Cancel turn
        </button>
        <button onClick={onDecline} className="px-2.5 py-1.5 rounded-md text-xs font-medium border" style={{ borderColor: "var(--destructive)", color: "var(--destructive-foreground)" }}>
          Decline
        </button>
        <button onClick={onAlwaysAllow} className="px-2.5 py-1.5 rounded-md text-xs font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
          Always allow this session
        </button>
        <button onClick={onApproveOnce} className="px-3 py-1.5 rounded-md text-xs font-medium text-white shadow-sm" style={{ background: "var(--primary)" }}>
          Approve once
        </button>
      </div>
    </div>
  );
}
