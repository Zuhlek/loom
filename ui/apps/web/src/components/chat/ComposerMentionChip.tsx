export default function ComposerMentionChip({ path }: { path: string }) {
  return (
    <span className="inline-flex max-w-full select-none items-center gap-1 rounded-md border border-[var(--border)]/70 bg-[var(--accent)]/40 px-1.5 py-px font-medium text-[12px] leading-[1.1] text-[var(--foreground)] align-middle">
      <span>@{path}</span>
    </span>
  );
}
