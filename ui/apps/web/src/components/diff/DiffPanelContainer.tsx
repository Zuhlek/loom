// DiffPanelContainer — right-drawer diff surface. Mounts unconditionally.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  getDiff,
  getGitStatus,
  postGitCommit,
  postGitPr,
  postGitPush,
  errorText,
  type ApiDiffSection,
  type ApiGitStatus,
} from "../../lib/api";
import { parseUnifiedDiff } from "../../lib/diff-parse";

import { BranchToolbar } from "./DiffPanel";
import type { DiffFile, DiffLine } from "./DiffPanel";
import { DiffFileCard } from "./DiffFileCard";
import { CommitDialog, type CommitDialogIntent } from "./CommitDialog";
import { useSnackbar } from "../ui/Snackbar";

export interface DiffPanelContainerProps {
  worktreePath: string | null;
  chatId: string;
  /**
   * Chat's VCS kind. `"unknown"` swaps the empty-state badge to the
   * "non-git project" copy and dims provider-routed affordances. Null
   * is treated as "git" pending the row's vcs_kind probe.
   */
  vcsKind?: "git" | "unknown" | null;
  /**
   * Monotonic counter bumped by the route when a turn's checkpoint lands.
   * A change re-fetches the total diff so the panel stays current without
   * the user clicking Refresh. Identity-only; the value is never read.
   */
  refreshSignal?: number;
}

type SnackbarState =
  | { kind: "commit"; sha: string }
  | { kind: "push"; remoteRef: string }
  | { kind: "pr"; url: string }
  | { kind: "error"; message: string }
  | null;

type DialogState = { intent: CommitDialogIntent; error?: string } | null;

// Resizable-panel bounds (px) and the localStorage key for the chosen width.
const PANEL_MIN_W = 360;
const PANEL_MAX_W = 1100;
const PANEL_DEFAULT_W = 560;
const PANEL_WIDTH_KEY = "loom.diffPanelWidth";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function deriveRemoteRef(status: ApiGitStatus | null): string {
  if (!status) return "remote";
  return `origin/${status.branch}`;
}

/**
 * Flatten the per-repo diff sections into a single render list. A lone
 * section (the common single-repo case) renders flat. When the workspace
 * spans multiple repos, each section's first file is prefixed with a
 * synthetic `meta` line carrying the repo's relative path so the user can
 * tell which repo a block belongs to. The root repo's empty label renders
 * as "(root)".
 */
export function buildSectionedFiles(sections: ApiDiffSection[]): DiffFile[] {
  const parsed = sections
    .map((s) => ({ label: s.label, files: parseUnifiedDiff(s.diff) }))
    .filter((s) => s.files.length > 0);

  if (parsed.length <= 1) {
    return parsed[0]?.files ?? [];
  }

  const out: DiffFile[] = [];
  for (const section of parsed) {
    let prefixed = false;
    for (const file of section.files) {
      if (!prefixed) {
        const labelMeta: DiffLine = { kind: "meta", text: section.label || "(root)" };
        const firstHunk = file.hunks[0] ?? [];
        const newHunks =
          file.hunks.length === 0
            ? [[labelMeta]]
            : [[labelMeta, ...firstHunk], ...file.hunks.slice(1)];
        out.push({ ...file, hunks: newHunks });
        prefixed = true;
      } else {
        out.push(file);
      }
    }
  }
  return out;
}

export function DiffPanelContainer(props: DiffPanelContainerProps) {
  const { worktreePath, chatId, refreshSignal } = props;
  const snackbarHost = useSnackbar();

  const [status, setStatus] = useState<ApiGitStatus | null>(null);
  const [sections, setSections] = useState<ApiDiffSection[]>([]);
  const [initialLoading, setInitialLoading] = useState<boolean>(
    worktreePath !== null,
  );
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [committing, setCommitting] = useState<boolean>(false);
  const [pushing, setPushing] = useState<boolean>(false);
  const [prOpening, setPrOpening] = useState<boolean>(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState>(null);

  // ---- Resizable width (persisted) ---------------------------------------
  // Diff lines don't wrap (overflow-x scroll per file), so a too-narrow panel
  // clips content. A left-edge drag handle lets the user widen it; the chosen
  // width survives reloads via localStorage.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    } catch {
      /* storage unavailable — use the default width */
    }
    return saved >= PANEL_MIN_W && saved <= PANEL_MAX_W ? saved : PANEL_DEFAULT_W;
  });
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      /* storage unavailable (private mode) — width simply won't persist */
    }
  }, [panelWidth]);

  const onResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: PointerEvent) => {
        // Panel sits on the right; dragging its left edge leftwards widens it.
        const next = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, startW + (startX - ev.clientX)));
        setPanelWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      // Suppress text selection / cursor flicker during the drag.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelWidth],
  );

  // Two controllers: one for the status fetch, one for the diff fetch.
  // Aborts cascade through `signal` on the underlying fetch.
  const statusCtrlRef = useRef<AbortController | null>(null);
  const diffCtrlRef = useRef<AbortController | null>(null);

  // ---- Fetch helpers -----------------------------------------------------

  const fetchStatus = useCallback(
    async (wt: string): Promise<void> => {
      statusCtrlRef.current?.abort();
      const controller = new AbortController();
      statusCtrlRef.current = controller;
      try {
        const result = await getGitStatus(wt);
        if (controller.signal.aborted) return;
        setStatus(result);
        setStatusError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setStatusError(errorText(err));
      }
    },
    [],
  );

  const fetchDiff = useCallback(
    async (wt: string): Promise<void> => {
      diffCtrlRef.current?.abort();
      const controller = new AbortController();
      diffCtrlRef.current = controller;
      try {
        const result = await getDiff(wt, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSections(result.sections);
        setDiffError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setDiffError(errorText(err));
      }
    },
    [],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!worktreePath) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchStatus(worktreePath), fetchDiff(worktreePath)]);
    } finally {
      setRefreshing(false);
    }
  }, [worktreePath, fetchStatus, fetchDiff]);

  // ---- Initial mount + chat switch: parallel fetch -----------------------

  useEffect(() => {
    if (!worktreePath) {
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    let cancelled = false;
    Promise.all([fetchStatus(worktreePath), fetchDiff(worktreePath)])
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
      statusCtrlRef.current?.abort();
      diffCtrlRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreePath, chatId]);

  // ---- Checkpoint-landed signal: silent re-fetch (no skeleton) -----------

  useEffect(() => {
    if (refreshSignal === undefined) return;
    if (!worktreePath) return;
    void fetchDiff(worktreePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // ---- Snackbar mirroring: container state → global useSnackbar ----------

  useEffect(() => {
    if (!snackbar) return;
    switch (snackbar.kind) {
      case "commit":
        snackbarHost.show({
          key: "diff-action",
          type: "success",
          message: `Committed ${shortSha(snackbar.sha)}.`,
        });
        break;
      case "push":
        snackbarHost.show({
          key: "diff-action",
          type: "success",
          message: `Pushed to ${snackbar.remoteRef}.`,
        });
        break;
      case "pr":
        snackbarHost.show({
          key: "diff-action",
          type: "success",
          message: "Pull request created.",
          action: { label: "View PR", url: snackbar.url },
        });
        break;
      case "error":
        snackbarHost.show({
          key: "diff-action",
          type: "error",
          message: snackbar.message,
        });
        break;
    }
    // We only fire when the snackbar identity changes — clear the
    // local pointer after dispatch so a repeat of the same payload
    // re-fires (the host's dedupe `key` handles cosmetic dedupe).
    setSnackbar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snackbar]);

  // ---- Chained action handlers -------------------------------------------

  const runCommit = useCallback(
    async (input: { message: string; body?: string }): Promise<{ sha: string } | null> => {
      if (!worktreePath) return null;
      setCommitting(true);
      try {
        const result = await postGitCommit({
          worktreePath,
          message: input.message,
          body: input.body,
        });
        return result;
      } catch (err) {
        // Inline dialog error only — the dialog stays open on a failed
        // commit, so a toast would be a redundant second surface.
        setDialog({ intent: dialog?.intent ?? "commit", error: errorText(err) });
        return null;
      } finally {
        setCommitting(false);
      }
    },
    [worktreePath, dialog?.intent],
  );

  const runPush = useCallback(async (): Promise<boolean> => {
    if (!worktreePath) return false;
    setPushing(true);
    try {
      const result = await postGitPush({ worktreePath, setUpstream: true });
      if ((result as { error?: string }).error) {
        const message = (result as { error: string }).error;
        setSnackbar({ kind: "error", message });
        return false;
      }
      return true;
    } catch (err) {
      setSnackbar({ kind: "error", message: errorText(err) });
      return false;
    } finally {
      setPushing(false);
    }
  }, [worktreePath]);

  const runPr = useCallback(
    async (title: string, body?: string): Promise<{ url: string } | null> => {
      if (!worktreePath) return null;
      setPrOpening(true);
      try {
        const result = await postGitPr({ worktreePath, title, body });
        return result;
      } catch (err) {
        setSnackbar({ kind: "error", message: errorText(err) });
        return null;
      } finally {
        setPrOpening(false);
      }
    },
    [worktreePath],
  );

  const handleDialogConfirm = useCallback(
    async (input: { message: string; body?: string }): Promise<void> => {
      const intent = dialog?.intent ?? "commit";
      try {
        if (intent === "commit") {
          const committed = await runCommit(input);
          if (committed) {
            setDialog(null);
            setSnackbar({ kind: "commit", sha: committed.sha });
          }
        } else if (intent === "commit-push") {
          const committed = await runCommit(input);
          if (committed) {
            const pushed = await runPush();
            if (pushed) {
              setDialog(null);
              setSnackbar({ kind: "push", remoteRef: deriveRemoteRef(status) });
            }
          }
        } else {
          // pr intent — uncommitted path: commit → push → pr.
          const committed = await runCommit(input);
          if (committed) {
            const pushed = await runPush();
            if (pushed) {
              const opened = await runPr(input.message, input.body);
              if (opened) {
                setDialog(null);
                setSnackbar({ kind: "pr", url: opened.url });
              }
            }
          }
        }
      } finally {
        // Post-action refresh always runs; success or partial failure.
        await refresh();
      }
    },
    [dialog?.intent, runCommit, runPush, runPr, refresh, status],
  );

  const onCommit = useCallback(() => {
    setDialog({ intent: "commit" });
  }, []);

  const onCommitPush = useCallback(() => {
    setDialog({ intent: "commit-push" });
  }, []);

  const onCreatePr = useCallback(async () => {
    if (!worktreePath) return;
    const uncommitted = status?.uncommitted === true;
    if (uncommitted) {
      // Dirty tree → open the dialog so the user supplies the
      // commit message that will be reused as the PR title.
      setDialog({ intent: "pr" });
      return;
    }
    // Clean tree → skip commit, push then open PR with the branch
    // name as the placeholder title.
    try {
      const pushed = await runPush();
      if (pushed) {
        const title = status?.branch ?? "PR";
        const opened = await runPr(title);
        if (opened) {
          setSnackbar({ kind: "pr", url: opened.url });
        }
      }
    } finally {
      await refresh();
    }
  }, [worktreePath, status, runPush, runPr, refresh]);

  const onRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // ---- Render ------------------------------------------------------------

  // Per ADR-009 the panel mounts for every chat, including non-git
  // cwds. The empty-state badge below covers both the no-changes path
  // (`vcs_kind === "git"`) and the non-git path (`vcs_kind === "unknown"`).

  const showError = statusError !== null || diffError !== null;
  const renderedFiles: DiffFile[] = buildSectionedFiles(sections);
  const isEmpty =
    !initialLoading && !showError && renderedFiles.length === 0;

  const toolbarProps = status
    ? {
        branch: status.branch,
        base: status.base,
        uncommitted: status.uncommitted,
        ahead: status.ahead,
        behind: status.behind,
        remote: status.remote,
      }
    : {
        branch: "…",
        base: "main",
        uncommitted: false,
        ahead: 0,
        behind: 0,
      };

  const actionBusy = committing || pushing || prOpening;

  return (
    <aside
      className="relative shrink-0 flex flex-col border-l"
      style={{ width: panelWidth, borderColor: "var(--border)" }}
      data-testid="diff-panel-container"
    >
      {/* Left-edge drag handle — widen the panel so non-wrapping diff lines
          aren't clipped. */}
      <div
        onPointerDown={onResizeStart}
        className="absolute left-0 top-0 z-10 h-full w-1.5 -ml-1 cursor-col-resize hover:bg-[var(--primary)]"
        style={{ touchAction: "none" }}
        title="Drag to resize"
        data-testid="diff-resize-handle"
        role="separator"
        aria-orientation="vertical"
      />

      <BranchToolbar
        {...toolbarProps}
        onCommit={onCommit}
        onCommitPush={onCommitPush}
        onCreatePr={onCreatePr}
        onRefresh={onRefresh}
        fileCount={renderedFiles.length}
        refreshing={refreshing}
        busy={actionBusy}
      />

      {dialog && (
        <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
          <CommitDialog
            intent={dialog.intent}
            busy={actionBusy}
            error={dialog.error}
            onCancel={() => setDialog(null)}
            onConfirm={handleDialogConfirm}
          />
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto p-2 space-y-2"
        style={{ background: "rgba(0,0,0,0.012)" }}
      >
        {initialLoading && (
          <div data-testid="diff-skeleton" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border animate-pulse h-20"
                style={{
                  borderColor: "var(--border)",
                  background: "rgba(0,0,0,0.04)",
                }}
              />
            ))}
          </div>
        )}

        {showError && (
          <div
            role="alert"
            data-testid="diff-error-callout"
            className="rounded-lg border p-3 text-[12px] space-y-2"
            style={{
              borderColor: "rgba(239,68,68,0.30)",
              background: "rgba(239,68,68,0.08)",
              color: "var(--destructive-foreground)",
            }}
          >
            <p className="font-medium">Failed to load diff</p>
            {statusError && <p className="text-[11px]">{statusError}</p>}
            {diffError && <p className="text-[11px]">{diffError}</p>}
            <button
              type="button"
              onClick={onRefresh}
              className="px-2 py-1 rounded-md text-[11px] font-medium border hover:bg-[var(--accent)]"
              style={{ borderColor: "var(--border)" }}
              data-testid="diff-retry"
            >
              Retry
            </button>
          </div>
        )}

        {isEmpty && (
          <div
            className="grid place-items-center py-8 text-center"
            data-testid="diff-empty"
          >
            <p
              className="text-[11px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              {props.vcsKind === "unknown"
                ? "non-git project"
                : "No changes on this branch yet."}
            </p>
          </div>
        )}

        {!initialLoading &&
          !showError &&
          renderedFiles.map((file, idx) => (
            <DiffFileCard
              key={`${file.path}::${idx}`}
              file={file}
            />
          ))}
      </div>
    </aside>
  );
}
