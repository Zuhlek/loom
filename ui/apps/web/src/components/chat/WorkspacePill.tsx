/**
 * Composer footer pill that consolidates the chat's git context into one
 * place: `<repo> · <branch> · <mode>`. Replaces the former separate
 * ModeIndicatorPill (working-tree mode) and AttachedRefPill (branch / no
 * git) — a single glanceable answer to "which repo, which branch, and am
 * I on the current checkout or a fresh worktree".
 *
 * `repoName` is the git top-level basename (server-resolved), NOT the
 * opened folder's name, so it stays correct when a chat is opened at a
 * sub-directory below the repo root.
 *
 * Display-only (no popover): the diff and worktree panels remain reachable
 * from the right rail.
 */
export interface WorkspacePillProps {
  repoName: string | null;
  branch: string | null;
  vcsKind: "git" | "unknown";
  worktreeMode: "local" | "worktree" | null;
  defaultEnvMode: "local" | "worktree";
}

function modeWord(mode: "local" | "worktree"): string {
  return mode === "worktree" ? "worktree" : "checkout";
}

export function WorkspacePill(props: WorkspacePillProps) {
  const { repoName, branch, vcsKind, worktreeMode, defaultEnvMode } = props;
  const unknown = vcsKind === "unknown";

  // Pre-first-send the mode isn't committed yet — fall back to the resolved
  // default and flag it as pending, mirroring the old ModeIndicatorPill copy.
  const pending = worktreeMode === null;
  const mode = worktreeMode ?? defaultEnvMode;

  const segments = unknown
    ? ["no git"]
    : [
        repoName ?? "repo",
        branch ?? "no branch",
        modeWord(mode) + (pending ? " (pending)" : ""),
      ];

  const title = unknown
    ? "Project has no git repository"
    : `Repo ${repoName ?? "(unknown)"} · branch ${branch ?? "(none)"} · ${modeWord(mode)}${pending ? " (pending first-send)" : ""}`;

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border"
      style={{
        borderColor: "var(--border)",
        color: "var(--muted-foreground)",
        background: "var(--card)",
        opacity: unknown ? 0.55 : 1,
      }}
      data-testid="workspace-pill"
      title={title}
    >
      {/* git-branch glyph so the git context is visually locatable */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3 shrink-0" aria-hidden>
        <circle cx="6" cy="6" r="2" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="8" r="2" />
        <path d="M6 8v8M18 10a6 6 0 01-6 6H6" />
      </svg>
      {segments.join(" · ")}
    </span>
  );
}
