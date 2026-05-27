export interface AttachedRefPillProps {
  branch: string | null;
  vcsKind: "git" | "unknown";
}

export function AttachedRefPill(props: AttachedRefPillProps) {
  const { branch, vcsKind } = props;
  const unknown = vcsKind === "unknown";
  const copy = unknown ? "no git" : (branch ?? "no branch");
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border"
      style={{
        borderColor: "var(--border)",
        color: "var(--muted-foreground)",
        background: "var(--card)",
        opacity: unknown ? 0.55 : 1,
      }}
      data-testid="attached-ref-pill"
      title={unknown ? "Project has no git repository" : `Attached ref: ${branch ?? "(none)"}`}
    >
      {copy}
    </span>
  );
}
