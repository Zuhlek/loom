export interface ModeIndicatorPillProps {
  worktreeMode: "local" | "worktree" | null;
  defaultEnvMode: "local" | "worktree";
}

function baseCopy(mode: "local" | "worktree"): string {
  return mode === "worktree" ? "new worktree" : "current checkout";
}

export function ModeIndicatorPill(props: ModeIndicatorPillProps) {
  const { worktreeMode, defaultEnvMode } = props;
  const copy =
    worktreeMode === null
      ? `${baseCopy(defaultEnvMode)} (pending first-send)`
      : baseCopy(worktreeMode);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border"
      style={{
        borderColor: "var(--border)",
        color: "var(--muted-foreground)",
        background: "var(--card)",
      }}
      data-testid="mode-indicator-pill"
      title="Chat working-tree mode"
    >
      {copy}
    </span>
  );
}
