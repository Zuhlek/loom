export interface PermissionRequestInlineProps {
  tool: string;
  prompt: string;
  args: Record<string, string>;
  reason?: string;
  onCancelTurn?: () => void;
  onDecline?: () => void;
  onAlwaysAllow?: () => void;
  onApproveOnce?: () => void;
}

export function PermissionRequestInline({ tool, prompt, args, reason, onCancelTurn, onDecline, onAlwaysAllow, onApproveOnce }: PermissionRequestInlineProps) {
  return (
    <div className="ml-10 rounded-xl border-2 overflow-hidden" style={{ borderColor: "var(--warning)", background: "rgba(245,158,11,0.04)" }}>
      <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(245,158,11,0.25)" }}>
        <div className="size-6 rounded-md grid place-items-center" style={{ background: "rgba(245,158,11,0.18)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--warning-foreground)" }}>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.18)", color: "var(--warning-foreground)" }}>
              PermissionRequest
            </span>
            <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              tool: {tool}
            </span>
          </div>
          <p className="text-sm font-medium mt-0.5">{prompt}</p>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          Arguments
        </div>
        <pre className="font-mono text-[11px] px-3 py-2 rounded-md border overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <code>
            {Object.entries(args).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: "var(--info-foreground)" }}>{k}</span>: {v}
              </div>
            ))}
          </code>
        </pre>
        {reason && (
          <div className="mt-2.5 flex items-start gap-1.5 px-2.5 py-1.5 rounded-md text-[10px]" style={{ background: "rgba(59,130,246,0.06)", color: "var(--info-foreground)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3 mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            <span>Reason from agent: "{reason}"</span>
          </div>
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
