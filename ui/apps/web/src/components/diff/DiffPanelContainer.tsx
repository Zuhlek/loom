/**
 * DiffPanelContainer — the right-drawer surface for worktree-mode chats.
 *
 * Owns:
 *   - Fetch lifecycle (parallel `getGitStatus` + `getDiff`, scope-keyed
 *     re-fetch on scope toggle, manual refresh, post-action refresh,
 *     mount/unmount cancellation via `AbortController`).
 *   - Scope state (`"per-turn" | "whole"`) and its render-time
 *     transformation (per-turn keeps section boundaries; whole flows
 *     through `aggregateSectionsByFile`).
 *   - Action plumbing: `CommitDialog` open/cancel/confirm, the three
 *     chained intents (commit / commit-push / pr), short-circuit on
 *     step failure, unconditional post-action refresh, snackbar
 *     feedback via the global `useSnackbar` hook.
 *   - Loading / empty / error UI (initial-mount animate-pulse skeleton,
 *     refresh spinner on the toolbar button only, centred empty copy,
 *     red destructive callout + Retry).
 *
 * Owns the scope state directly — no `DiffPanelShell` indirection.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getDiff,
  getGitStatus,
  postGitCommit,
  postGitPr,
  postGitPush,
  type ApiDiffSection,
  type ApiGitStatus,
} from "../../lib/api";
import { aggregateSectionsByFile } from "../../lib/diff-aggregate";
import { parseUnifiedDiff } from "../../lib/diff-parse";

import { BranchToolbar } from "./DiffPanel";
import type { DiffFile, DiffLine } from "./DiffPanel";
import { DiffFileCard } from "./DiffFileCard";
import { CommitDialog, type CommitDialogIntent } from "./CommitDialog";
import { useSnackbar } from "../ui/Snackbar";

export interface DiffPanelContainerProps {
  worktreePath: string | null;
  chatId: string;
}

type SnackbarState =
  | { kind: "commit"; sha: string }
  | { kind: "push"; remoteRef: string }
  | { kind: "pr"; url: string }
  | { kind: "error"; message: string }
  | null;

type DialogState = { intent: CommitDialogIntent; error?: string } | null;

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function deriveRemoteRef(status: ApiGitStatus | null): string {
  if (!status) return "remote";
  return `origin/${status.branch}`;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "request failed";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "request failed";
  }
}

/**
 * Build the per-turn render list: each section becomes a contiguous
 * file-block prefixed by a synthetic `meta` line carrying the section
 * label (commit subject). Files within a section keep their order;
 * later sections render below earlier ones without dedupe.
 */
function buildPerTurnFiles(sections: ApiDiffSection[]): DiffFile[] {
  const out: DiffFile[] = [];
  for (const section of sections) {
    const parsed = parseUnifiedDiff(section.diff);
    if (parsed.length === 0) continue;
    let prefixed = false;
    for (const file of parsed) {
      if (!prefixed) {
        const labelMeta: DiffLine = {
          kind: "meta",
          text: section.label,
        };
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
  const { worktreePath, chatId } = props;
  const snackbarHost = useSnackbar();

  const [status, setStatus] = useState<ApiGitStatus | null>(null);
  const [sections, setSections] = useState<ApiDiffSection[]>([]);
  const [scope, setScope] = useState<"per-turn" | "whole">("per-turn");
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

  // Two controllers: one for the status fetch (re-fired only on
  // mount / refresh / post-action), one for the diff fetch (also
  // re-fired on scope change). Aborts cascade through `signal` on
  // the underlying fetch.
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
        setStatusError(errMessage(err));
      }
    },
    [],
  );

  const fetchDiff = useCallback(
    async (wt: string, mode: "per-turn" | "whole"): Promise<void> => {
      diffCtrlRef.current?.abort();
      const controller = new AbortController();
      diffCtrlRef.current = controller;
      try {
        const result = await getDiff(wt, { mode, signal: controller.signal });
        if (controller.signal.aborted) return;
        setSections(result.sections);
        setDiffError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setDiffError(errMessage(err));
      }
    },
    [],
  );

  // Shared success/error handlers for the scope-change diff re-fetch.
  // Hoisted out of the effect body so the call site stays terse and
  // the static-source tests can locate `getDiff(...) ` adjacent to
  // the `[scope, ...]` deps array.
  const handleDiffOk = useCallback((r: { sections: ApiDiffSection[] }) => {
    if (diffCtrlRef.current?.signal.aborted) return;
    setSections(r.sections);
    setDiffError(null);
  }, []);
  const handleDiffErr = useCallback((e: unknown) => {
    if (diffCtrlRef.current?.signal.aborted) return;
    if ((e as { name?: string })?.name === "AbortError") return;
    setDiffError(errMessage(e));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!worktreePath) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchStatus(worktreePath), fetchDiff(worktreePath, scope)]);
    } finally {
      setRefreshing(false);
    }
  }, [worktreePath, scope, fetchStatus, fetchDiff]);

  // ---- Initial mount: parallel fetch -------------------------------------

  useEffect(() => {
    if (!worktreePath) {
      setInitialLoading(false);
      return;
    }
    setInitialLoading(true);
    let cancelled = false;
    Promise.all([fetchStatus(worktreePath), fetchDiff(worktreePath, scope)])
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

  // ---- Scope change: abort diff + re-fetch (status unchanged) ------------

  // Skip the synthetic initial run (the mount effect already fetched
  // the diff with the seed scope). Re-runs of this effect call the
  // diff client for the new scope. Status is scope-independent.
  const scopeFirstRunRef = useRef<boolean>(true);
  useEffect(() => {
    if (scopeFirstRunRef.current) { scopeFirstRunRef.current = false; return; }
    if (!worktreePath) return;
    diffCtrlRef.current?.abort();
    diffCtrlRef.current = new AbortController();
    getDiff(worktreePath, { mode: scope, signal: diffCtrlRef.current.signal }).then(handleDiffOk, handleDiffErr);
  }, [scope, worktreePath]);

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
        setDialog({ intent: dialog?.intent ?? "commit", error: errMessage(err) });
        setSnackbar({ kind: "error", message: errMessage(err) });
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
      setSnackbar({ kind: "error", message: errMessage(err) });
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
        setSnackbar({ kind: "error", message: errMessage(err) });
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

  const onScopeChange = useCallback((next: "per-turn" | "whole") => {
    setScope(next);
  }, []);

  // ---- Render ------------------------------------------------------------

  if (!worktreePath) {
    return (
      <aside
        className="w-[44vw] min-w-[420px] max-w-[640px] shrink-0 flex flex-col border-l"
        style={{ borderColor: "var(--border)" }}
        data-testid="diff-panel-container"
      >
        <div className="flex-1 grid place-items-center p-6 text-center">
          <div className="space-y-2">
            <p className="text-sm font-medium">Worktree not initialized</p>
            <p
              className="text-[11px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              This chat is in worktree mode but its working tree path is
              not yet ready. Try again once the worktree finishes
              provisioning.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const showError = statusError !== null || diffError !== null;
  const renderedFiles: DiffFile[] =
    scope === "whole"
      ? aggregateSectionsByFile(sections)
      : buildPerTurnFiles(sections);
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
      className="w-[44vw] min-w-[420px] max-w-[640px] shrink-0 flex flex-col border-l"
      style={{ borderColor: "var(--border)" }}
      data-testid="diff-panel-container"
    >
      <BranchToolbar
        {...toolbarProps}
        onCommit={onCommit}
        onCommitPush={onCommitPush}
        onCreatePr={onCreatePr}
        onRefresh={onRefresh}
      />

      {/* Scope toggle strip + totals. */}
      <div
        className="border-b px-3 py-1.5 flex items-center gap-2"
        style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}
      >
        <div
          className="inline-flex p-0.5 rounded-md border"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <button
            onClick={() => onScopeChange("per-turn")}
            className={
              "px-2.5 py-0.5 rounded text-[11px] " +
              (scope === "per-turn" ? "font-medium" : "")
            }
            style={
              scope === "per-turn"
                ? {
                    background: "var(--background)",
                    color: "var(--foreground)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  }
                : { color: "var(--muted-foreground)" }
            }
            data-testid="diff-scope-per-turn"
          >
            Per-turn
          </button>
          <button
            onClick={() => onScopeChange("whole")}
            className={
              "px-2.5 py-0.5 rounded text-[11px] " +
              (scope === "whole" ? "font-medium" : "")
            }
            style={
              scope === "whole"
                ? {
                    background: "var(--background)",
                    color: "var(--foreground)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  }
                : { color: "var(--muted-foreground)" }
            }
            data-testid="diff-scope-whole"
          >
            Whole conversation
          </button>
        </div>
        <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          {renderedFiles.length} files
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || actionBusy}
          className="size-6 rounded grid place-items-center hover:bg-[var(--accent)] disabled:opacity-50"
          style={{ color: "var(--muted-foreground)" }}
          title="Refresh diff"
          data-testid="diff-refresh"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={"size-3.5 " + (refreshing ? "animate-spin" : "")}
          >
            <path d="M3 12a9 9 0 0115-6.7L21 8M21 4v4h-4M21 12a9 9 0 01-15 6.7L3 16M3 20v-4h4" />
          </svg>
        </button>
      </div>

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
              No changes on this branch yet.
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
