import clsx from "clsx";

export interface ChatHeaderProps {
  title: string;
  permissionMode: "default" | "plan" | "accept-edits" | "trusted-vm";
  cwd: string;
  /** "local" | "worktree" */
  mode: "local" | "worktree";
  /** worktree-mode branch e.g. "loom/plan-deploy/abc123" */
  branch?: string;
  onTerminalToggle?: () => void;
  onMenuOpen?: (e: React.MouseEvent) => void;
}

const PERMISSION_DOT: Record<ChatHeaderProps["permissionMode"], string> = {
  default: "var(--success)",
  plan: "var(--info)",
  "accept-edits": "var(--warning)",
  "trusted-vm": "var(--destructive)",
};

const PERMISSION_LABEL: Record<ChatHeaderProps["permissionMode"], string> = {
  default: "Default",
  plan: "Plan",
  "accept-edits": "Accept-edits",
  "trusted-vm": "Trusted-VM",
};

export function ChatHeader({ title, permissionMode, cwd, mode, branch, onTerminalToggle, onMenuOpen }: ChatHeaderProps) {
  const dot = PERMISSION_DOT[permissionMode];
  const label = PERMISSION_LABEL[permissionMode];
  return (
    <header className="border-b flex items-center px-4 py-2.5 gap-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{title}</span>
        <span
          className={clsx(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium",
          )}
          style={{ background: `${dot.replace("var(--", "rgba(").replace(")", "")}, 0.15)`, color: "var(--success-foreground)" }}
        >
          <span className="size-1.5 rounded-full" style={{ background: dot }} />
          {label}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
          {mode}
        </span>
        {mode === "worktree" && branch && (
          <code className="text-[10px] font-mono truncate" style={{ color: "var(--muted-foreground)" }}>
            ⎇ {branch}
          </code>
        )}
        {mode === "local" && (
          <span className="text-[10px] font-mono truncate" style={{ color: "var(--muted-foreground)" }}>
            {cwd}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onTerminalToggle}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] hover:bg-[var(--accent)] border"
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
          title="Toggle terminal"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
            <path d="M4 6h16v12H4zM7 9l3 3-3 3M13 15h4" />
          </svg>
          Terminal
        </button>
        <button
          onClick={onMenuOpen}
          className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
          style={{ color: "var(--muted-foreground)" }}
          title="Handoff/fork menu"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
            <circle cx="12" cy="6" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="18" r="1.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}
