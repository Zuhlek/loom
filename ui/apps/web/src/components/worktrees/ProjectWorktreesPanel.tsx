import { useCallback, useEffect, useState } from "react";
import {
  vcsVerbTooltip,
  type VcsVerbKind,
} from "../diff/vcs-verb-copy";
import { errorText } from "../../lib/api";

export interface WorktreeInfoView {
  path: string;
  branch: string | null;
  head: string | null;
  tenantChatIds: string[];
}

export interface ProjectWorktreesPanelProps {
  vcsKind: "git" | "unknown" | null;
  /** Test seam — defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export function ProjectWorktreesPanel(props: ProjectWorktreesPanelProps) {
  const fetcher = props.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const [worktrees, setWorktrees] = useState<WorktreeInfoView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<
    | null
    | { worktreePath: string; coTenants: string[] }
  >(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetcher("/worktrees");
      if (!res.ok) {
        setError(`worktrees fetch failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as { worktrees: WorktreeInfoView[] };
      setWorktrees(body.worktrees ?? []);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [fetcher]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const deleteWorktree = useCallback(
    async (worktreePath: string, confirm: boolean): Promise<void> => {
      try {
        const res = await fetcher("/worktrees/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ worktreePath, confirm }),
        });
        if (res.status === 409) {
          const body = (await res.json()) as { co_tenants: string[] };
          setConfirmModal({ worktreePath, coTenants: body.co_tenants ?? [] });
          return;
        }
        if (!res.ok) {
          setError(`delete failed: ${res.status}`);
          return;
        }
        setConfirmModal(null);
        await reload();
      } catch (e) {
        setError(errorText(e));
      }
    },
    [fetcher, reload],
  );

  const dimmed = props.vcsKind === "unknown";
  const verbKind: VcsVerbKind = "removeWorktree";
  const dimTitle = vcsVerbTooltip(verbKind, "not-a-git-repo");

  return (
    <div data-testid="project-worktrees-panel" className="p-3 space-y-2">
      <h3 className="text-sm font-medium">Worktrees</h3>
      {error && (
        <p
          role="alert"
          className="text-[11px]"
          style={{ color: "var(--destructive-foreground)" }}
        >
          {error}
        </p>
      )}
      <ul className="space-y-1">
        {worktrees.map((w) => (
          <li
            key={w.path}
            className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-md border"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
            data-testid={`worktree-row-${w.path}`}
          >
            <span className="font-mono truncate flex-1">{w.path}</span>
            <span style={{ color: "var(--muted-foreground)" }}>
              {w.branch ?? "(detached)"}
            </span>
            <button
              type="button"
              className="px-2 py-0.5 rounded text-[10px] border"
              style={{
                borderColor: "var(--border)",
                color: dimmed ? "var(--muted-foreground)" : "var(--foreground)",
                opacity: dimmed ? 0.45 : 1,
                cursor: dimmed ? "not-allowed" : "pointer",
              }}
              title={dimmed ? dimTitle : `Remove ${w.path}`}
              disabled={dimmed}
              onClick={() => {
                if (dimmed) return;
                void deleteWorktree(w.path, false);
              }}
              data-testid={`worktree-delete-${w.path}`}
            >
              Remove
            </button>
          </li>
        ))}
        {worktrees.length === 0 && (
          <li
            className="text-[11px] py-2 text-center"
            style={{ color: "var(--muted-foreground)" }}
          >
            No worktrees.
          </li>
        )}
      </ul>

      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="worktree-delete-confirm"
          className="rounded-md border p-3 text-[11px] space-y-2"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <p className="font-medium">Confirm worktree removal</p>
          <p style={{ color: "var(--muted-foreground)" }}>
            This worktree is referenced by {confirmModal.coTenants.length} chat(s):
          </p>
          <ul className="ml-4 list-disc">
            {confirmModal.coTenants.map((id) => (
              <li key={id} className="font-mono">
                {id}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmModal(null)}
              className="px-2 py-1 rounded text-[10px] border"
              style={{ borderColor: "var(--border)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteWorktree(confirmModal.worktreePath, true)}
              className="px-2 py-1 rounded text-[10px] border"
              style={{
                borderColor: "var(--border)",
                background: "var(--destructive-foreground)",
              }}
              data-testid="worktree-delete-confirm-ok"
            >
              Remove anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
