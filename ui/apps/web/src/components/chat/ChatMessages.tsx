import type { ReactNode } from "react";

interface MessageProps {
  role: "user" | "assistant";
  /** Display name; defaults to "You" / "Claude" */
  name?: string;
  /** Subtitle on header (model + time) */
  subtitle?: string;
  /** Whether to show streaming-indicator dot */
  streaming?: boolean;
  children?: ReactNode;
}

export function ChatMessage({ role, name, subtitle, streaming, children }: MessageProps) {
  const isUser = role === "user";
  return (
    <div className="flex gap-3">
      {isUser ? (
        <div className="size-7 rounded-full shrink-0 grid place-items-center text-[10px] font-medium text-white" style={{ background: "var(--primary)" }}>
          T
        </div>
      ) : (
        <div className="size-7 rounded-md shrink-0 grid place-items-center text-[10px] font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "var(--foreground)" }}>
          C
        </div>
      )}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium">{name ?? (isUser ? "You" : "Claude")}</span>
          {subtitle && (
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {subtitle}
            </span>
          )}
          {streaming && <span className="size-1.5 rounded-full animate-pulse" style={{ background: "var(--info)" }} />}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SubagentCard({ tool, target, summary }: { tool: string; target: string; summary?: string }) {
  return (
    <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
      <div className="flex items-center gap-2 text-[11px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5" style={{ color: "var(--info)" }}>
          <path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-medium">{tool}</span>
        <code className="font-mono" style={{ color: "var(--muted-foreground)" }}>
          {target}
        </code>
        {summary && (
          <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            {summary}
          </span>
        )}
      </div>
    </div>
  );
}

export function SlashCommandDivider({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
      <span className="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded font-mono" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        {command}
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}
