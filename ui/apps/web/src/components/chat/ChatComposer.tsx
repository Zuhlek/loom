import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import clsx from "clsx";
import type {
  PermissionMode,
  UserTurnImage,
  WireSlashCommand,
} from "../../lib/chat-types";
import {
  detectAtFileTrigger,
  detectSlashCommandTrigger,
  replaceTextRange,
} from "../../lib/composer-trigger";
import { ComposerAtFileMenu } from "./ComposerAtFileMenu";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerKeyIntent,
} from "./ComposerEditor";
import { ComposerFooterToolbar } from "./ComposerFooterToolbar";
import { ComposerSlashMenu } from "./ComposerSlashMenu";
import { buildSlashMenuRows, type SlashMenuRow } from "./ComposerSlashMenu";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { WorkspacePill } from "./WorkspacePill";
import type { ContextUsageSnapshot } from "../../lib/use-chat-bridge";

/**
 * Composer policy mirror — kept in sync with `routes/live-chat.tsx`'s
 * `ComposerMode` type. Splits hard-disable (blocked) from
 * queue-while-running (queue) from editable-but-unsendable (offline)
 * from default-enabled (ready). Only `"blocked"` hard-disables the
 * textarea/attachments; `"offline"` keeps them editable but disables
 * the send action with a connection reason.
 */
export type ComposerMode = "ready" | "queue" | "blocked" | "offline";

export interface ChatComposerProps {
  /**
   * Three-state composer policy. The composer hard-disables iff
   * `composerMode === "blocked"`; the queue mode changes the send
   * affordance (label / title says "Queue") but keeps the textarea +
   * button enabled so the user can push a follow-up while the turn
   * streams. When omitted the composer falls back to the `disabled`
   * boolean derivation.
   */
  composerMode?: ComposerMode;
  /** Disabled when there is a pending AskUserQuestion or PermissionRequest. */
  disabled?: boolean;
  disabledReason?: string;
  /** Compact narrows for the worktree-mode pane. */
  compact?: boolean;
  /**
   * Submit handler. Always receives `images` as an array (empty when
   * no attachments are held).
   */
  onSubmit?: (text: string, images: UserTurnImage[]) => void;
  /** When true, the running turn is interruptable — shows a stop button. */
  isRunning?: boolean;
  onInterrupt?: () => void;

  /**
   * Permission-mode dispatcher. The composer only WRITES the mode —
   * the `/plan` and `/default` built-in slash-commands forward through
   * this and the route emits a `permission-mode-set` frame. The mode is
   * otherwise viewed / changed from the {@link ChatSettingsModal}.
   */
  onPermissionModeChange?: (mode: PermissionMode) => void;

  /**
   * When true (parent derives from `turnState === "interrupted"`) the
   * composer renders a distinct amber "Interrupted" pill adjacent to
   * the Stop/Send control. The pill is informational; the SDK's
   * implicit re-prime resumes the cancelled turn when the next user
   * message arrives via `UserMessageQueue`.
   */
  isInterrupted?: boolean;

  /**
   * Chat's current working directory — forwarded to the `/file-search`
   * endpoint for the `@`-file picker. When undefined the fetch is
   * skipped and the menu can still render an empty / loading state.
   */
  cwd?: string;

  /**
   * Bridge-supplied slash-command catalog delivered via the
   * `slash-commands-update` frame and routed through
   * {@link useChatBridge}. `null` until the first frame lands (drives
   * the "Loading commands…" affordance under the PROVIDER header).
   * Built-in rows are merged client-side inside
   * {@link ComposerSlashMenu}.
   */
  slashCommands?: WireSlashCommand[] | null;

  /**
   * Opens the {@link ChatSettingsModal} (model / reasoning / context /
   * mode / access). The `/model` built-in slash-command dispatch calls
   * this so typing `/model` still jumps straight to the model setting —
   * it just lives in the modal now rather than a footer pill.
   */
  onOpenSettings?: () => void;

  /**
   * Bridge-supplied context-window utilisation. `null` until the
   * first `context-usage-update` frame lands — the
   * {@link ContextUsageIndicator} renders 0% in that case.
   */
  contextUsage?: ContextUsageSnapshot | null;

  /**
   * Chat's working-tree mode. `null` until the first-send hook commits
   * a mode for the chat; the {@link WorkspacePill} renders the resolved
   * `defaultEnvMode` with a "(pending)" qualifier while null.
   */
  worktreeMode?: "local" | "worktree" | null;
  /**
   * Server-side resolved default env mode (from `GET /settings`). Drives
   * the pre-commit copy of {@link WorkspacePill}.
   */
  defaultEnvMode?: "local" | "worktree";
  /** Current attached ref / branch (`null` when none). */
  branch?: string | null;
  /** Cached VCS kind for the chat's cwd. */
  vcsKind?: "git" | "unknown" | null;
  /** Repo display name (git top-level basename); `null` when non-git. */
  repoName?: string | null;
}

/**
 * One held attachment inside the composer. The `file` field is the
 * original `File` (used for submit-time base64 encode); `previewUrl`
 * is a `URL.createObjectURL(file)` blob URL used exclusively for the
 * in-composer thumbnail (revoked on remove, on post-submit clear, and
 * on unmount). `mediaType` is the sniffed / declared MIME (defaults
 * to `image/png` when blank).
 */
interface ComposerAttachment {
  id: string;
  file: File;
  mediaType: string;
  previewUrl: string;
  filename: string;
}

const ATTACHMENT_CAP = 4;
const ATTACHMENT_MAX_BYTES = 5_000_000;
const OVER_CAP_NOTICE_MS = 3000;
const AT_FILE_DEBOUNCE_MS = 150;
const COMPOSER_PLACEHOLDER = "Ask Claude anything · @ for files · / for commands";

export function ChatComposer({
  composerMode,
  disabled,
  disabledReason,
  compact,
  onSubmit,
  isRunning,
  onInterrupt,
  onPermissionModeChange,
  isInterrupted,
  cwd,
  slashCommands,
  onOpenSettings,
  contextUsage,
  worktreeMode,
  defaultEnvMode,
  branch,
  vcsKind,
  repoName,
}: ChatComposerProps) {
  // Resolve hard-disable + send-affordance flags from the three-state
  // composer mode. When `composerMode` is omitted the `disabled`
  // boolean is the only signal.
  const isBlocked = composerMode === "blocked";
  const isQueueMode = composerMode === "queue";
  // Offline = raw socket not open and no tool gate pending. Deliberately
  // NOT folded into `hardDisabled`: the textarea + attachments stay
  // editable so the user can keep a draft through a transient reconnect.
  // Only the send action is disabled (see send buttons below) with the
  // `disabledReason` surfaced as a title + inline footer hint.
  const isOffline = composerMode === "offline";
  const hardDisabled = isBlocked || !!disabled;
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const handleEditorStateChange = useCallback((state: { text: string; cursor: number }) => {
    setValue(state.text);
    setCursor(state.cursor);
  }, []);
  const editorRef = useRef<ComposerEditorHandle | null>(null);

  // Attachment state machine. The `attachmentsRef` mirror lets the
  // unmount cleanup revoke object URLs without listing `attachments`
  // in the effect's dependency array (which would re-fire the cleanup
  // on every add/remove and double-revoke).
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [overCapNotice, setOverCapNotice] = useState<string | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const overCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state for the data-dragging highlight. The container toggles
  // a `data-dragging` attribute that CSS keys off.
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Hidden file-picker input ref.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Parallel @-file menu state. Runs alongside the slash-menu state
  // above; the mutual-exclusion guard below ensures only one menu
  // opens at a time.
  const [atFileMenuOpen, setAtFileMenuOpen] = useState(false);
  const [atFileSelectedIndex, setAtFileSelectedIndex] = useState(0);
  const [atFileQuery, setAtFileQuery] = useState("");
  const [atFileResults, setAtFileResults] = useState<string[]>([]);
  const [atFileLoading, setAtFileLoading] = useState(false);
  const atFileTriggerRef = useRef<{ rangeStart: number; rangeEnd: number } | null>(null);

  // Slash-menu state machine. Detection runs on every (value, cursor)
  // update; the menu opens whenever the editor matches
  // `^/<non-whitespace>*` on the current line, and the bridge-supplied
  // catalog drives the Provider section via {@link ComposerSlashMenu}.
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuQuery, setSlashMenuQuery] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashTriggerRef = useRef<{ rangeStart: number; rangeEnd: number } | null>(null);

  // @-file detection runs on every (value, cursor) update.
  const atTrigger = useMemo(
    () => (hardDisabled ? null : detectAtFileTrigger(value, cursor)),
    [value, cursor, hardDisabled],
  );

  // Slash-trigger detection mirrors the @-file pattern. The two menus
  // are mutually exclusive — the @ menu wins because it's anchored to a
  // strict whitespace-then-`@` rule that can't coexist with a leading-
  // slash line. See `composer-trigger.ts` for both detectors.
  const slashTrigger = useMemo(
    () => (hardDisabled || atTrigger ? null : detectSlashCommandTrigger(value, cursor)),
    [value, cursor, hardDisabled, atTrigger],
  );

  // Open / close the @-menu in response to the trigger.
  useEffect(() => {
    if (atTrigger) {
      atFileTriggerRef.current = {
        rangeStart: atTrigger.rangeStart,
        rangeEnd: atTrigger.rangeEnd,
      };
      if (!atFileMenuOpen) setAtFileMenuOpen(true);
      if (atFileQuery !== atTrigger.query) {
        setAtFileQuery(atTrigger.query);
        setAtFileSelectedIndex(0);
      }
    } else if (atFileMenuOpen) {
      setAtFileMenuOpen(false);
      setAtFileResults([]);
      setAtFileQuery("");
    }
  }, [atTrigger, atFileMenuOpen, atFileQuery]);

  // Open / close the slash-menu in response to its trigger. Resets the
  // selection index whenever the typed query changes so the keyboard
  // highlight starts at the top of the (re-filtered) list.
  useEffect(() => {
    if (slashTrigger) {
      slashTriggerRef.current = {
        rangeStart: slashTrigger.rangeStart,
        rangeEnd: slashTrigger.rangeEnd,
      };
      if (!slashMenuOpen) setSlashMenuOpen(true);
      if (slashMenuQuery !== slashTrigger.query) {
        setSlashMenuQuery(slashTrigger.query);
        setSlashSelectedIndex(0);
      }
    } else if (slashMenuOpen) {
      setSlashMenuOpen(false);
      setSlashMenuQuery("");
    }
  }, [slashTrigger, slashMenuOpen, slashMenuQuery]);

  // Flat row list (built-ins + filtered providers) — drives keyboard
  // nav bounds and the accept handler. Mirrors the same merge
  // `ComposerSlashMenu` performs internally so the parent and child
  // agree on row indices.
  const slashRows = useMemo<SlashMenuRow[]>(() => {
    if (!slashMenuOpen) return [];
    const { builtins, providers } = buildSlashMenuRows(
      slashMenuQuery,
      slashCommands ?? null,
    );
    return [...builtins, ...providers];
  }, [slashMenuOpen, slashMenuQuery, slashCommands]);

  // Clamp the selected index whenever the underlying row list shrinks
  // (e.g. typing narrows the filter past the highlighted row).
  useEffect(() => {
    if (slashSelectedIndex >= slashRows.length && slashRows.length > 0) {
      setSlashSelectedIndex(0);
    }
  }, [slashRows.length, slashSelectedIndex]);

  // Debounced /file-search fetch with AbortController cancel.
  useEffect(() => {
    if (!atFileMenuOpen) return;
    if (!cwd) {
      // Without a cwd the server can't resolve the search — render the
      // empty/loading state and skip the fetch.
      setAtFileResults([]);
      setAtFileLoading(false);
      return;
    }
    const controller = new AbortController();
    setAtFileLoading(true);
    const handle = setTimeout(() => {
      const url = `/api/file-search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(atFileQuery)}`;
      fetch(url, { signal: controller.signal })
        .then((res) => res.json())
        .then((json: { results?: string[] }) => {
          const results = Array.isArray(json?.results) ? json.results.slice(0, 50) : [];
          setAtFileResults(results);
          setAtFileLoading(false);
        })
        .catch((err) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          setAtFileResults([]);
          setAtFileLoading(false);
          console.warn("[ChatComposer] /file-search failed", err);
        });
    }, AT_FILE_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [atFileMenuOpen, atFileQuery, cwd]);

  // When the query is empty, surface the top 5 walked files as a browse
  // sample so the user sees that the picker works; once the user starts
  // typing, fall through to the full ranked list (server-capped at 50).
  const displayedAtFileResults = useMemo(() => {
    if (atFileQuery.trim() === "") return atFileResults.slice(0, 5);
    return atFileResults;
  }, [atFileQuery, atFileResults]);

  // Unmount cleanup — revoke every held `previewUrl`.
  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        URL.revokeObjectURL(att.previewUrl);
      }
      if (overCapTimerRef.current !== null) {
        clearTimeout(overCapTimerRef.current);
        overCapTimerRef.current = null;
      }
    };
  }, []);

  const scheduleNoticeClear = () => {
    if (overCapTimerRef.current !== null) clearTimeout(overCapTimerRef.current);
    overCapTimerRef.current = setTimeout(() => {
      setOverCapNotice(null);
      overCapTimerRef.current = null;
    }, OVER_CAP_NOTICE_MS);
  };

  const addAttachments = async (files: File[]) => {
    // Three-stage uniform pipeline used by paste / paperclip / drag-drop.
    //   1. Image-only filter (declared MIME starts with image/* OR
    //      blank-MIME case which we'll resolve via magic-byte sniff).
    //   2. Size filter — drop > 5MB with the dedicated notice.
    //   3. Cap filter — limit total to 4; drop excess with the dedicated
    //      notice. The "skipped — limit is 4 per turn" notice wins over
    //      the size notice when both fire on the same call.
    const candidates: File[] = [];
    let sawOverSize = false;
    for (const file of files) {
      const declared = file.type ?? "";
      const isImageDeclared = declared.startsWith("image/");
      const isBlankMime = declared === "";
      if (!isImageDeclared && !isBlankMime) continue;
      if (file.size > ATTACHMENT_MAX_BYTES) {
        sawOverSize = true;
        continue;
      }
      candidates.push(file);
    }

    const remaining = ATTACHMENT_CAP - attachmentsRef.current.length;
    let sawOverCap = false;
    let accepted = candidates;
    if (candidates.length > remaining) {
      accepted = candidates.slice(0, Math.max(0, remaining));
      sawOverCap = true;
    }

    const built: ComposerAttachment[] = [];
    for (const file of accepted) {
      const mediaType = await resolveMediaType(file);
      built.push({
        id: makeId(),
        file,
        mediaType,
        previewUrl: URL.createObjectURL(file),
        filename: file.name || "image",
      });
    }
    if (built.length > 0) {
      setAttachments((prev) => [...prev, ...built]);
    }
    if (sawOverCap) {
      setOverCapNotice("Skipped — limit is 4 per turn");
      scheduleNoticeClear();
    } else if (sawOverSize) {
      setOverCapNotice("Image too large — max 5MB");
      scheduleNoticeClear();
    }
  };

  const removeAttachment = (id: string) => {
    const match = attachmentsRef.current.find((a) => a.id === id);
    if (!match) return;
    URL.revokeObjectURL(match.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const acceptAtFile = (path: string) => {
    const trigger = atFileTriggerRef.current;
    if (!trigger) return;
    editorRef.current?.insertMention(path, {
      start: trigger.rangeStart,
      end: trigger.rangeEnd,
    });
    setAtFileMenuOpen(false);
    setAtFileResults([]);
    setAtFileQuery("");
    queueMicrotask(() => editorRef.current?.focus());
  };

  // Accept a slash-menu row. Built-in rows (`/model`, `/plan`,
  // `/default`) fire Loom-side actions and never touch the textarea:
  // `/plan` and `/default` dispatch through
  // {@link onPermissionModeChange}; `/model` opens the settings modal
  // via {@link onOpenSettings} (the model setting lives there now).
  // SDK provider rows (and skills) write `/<name> ` into the textarea
  // at the trigger range so the user lands one keystroke away from
  // arguments.
  const acceptSlash = (row: SlashMenuRow) => {
    const trigger = slashTriggerRef.current;
    if (!trigger) return;
    if (row.kind === "builtin") {
      if (row.name === "plan") onPermissionModeChange?.("plan");
      else if (row.name === "default") onPermissionModeChange?.("default");
      else if (row.name === "model") {
        onOpenSettings?.();
      }
      setSlashMenuOpen(false);
      setSlashMenuQuery("");
      queueMicrotask(() => editorRef.current?.focus());
      return;
    }
    const replacement = `/${row.name} `;
    const next = replaceTextRange(
      editorRef.current?.getPlainText() ?? "",
      trigger.rangeStart,
      trigger.rangeEnd,
      replacement,
    );
    editorRef.current?.setPlainText(next.text);
    setSlashMenuOpen(false);
    setSlashMenuQuery("");
    queueMicrotask(() => editorRef.current?.focus());
  };

  const submit = async () => {
    const text = (editorRef.current?.getPlainText() ?? "").trim();
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments) return;
    if (!onSubmit) return;
    const images = await Promise.all(attachments.map(encodeAttachment));
    onSubmit(text, images);
    for (const att of attachments) {
      URL.revokeObjectURL(att.previewUrl);
    }
    setAttachments([]);
    editorRef.current?.setPlainText("");
    queueMicrotask(() => editorRef.current?.focus());
  };

  const canSend = value.trim().length > 0 || attachments.length > 0;

  const handleKeyIntent = useCallback(
    (intent: ComposerKeyIntent): boolean => {
      if (intent.kind === "submit") {
        if (slashMenuOpen && slashRows.length > 0) {
          acceptSlash(slashRows[slashSelectedIndex]);
          return true;
        }
        if (canSend) {
          void submit();
          return true;
        }
        return false;
      }
      if (intent.kind === "enter-menu" || intent.kind === "tab") {
        if (slashMenuOpen && slashRows.length > 0) {
          acceptSlash(slashRows[slashSelectedIndex]);
          return true;
        }
        if (atFileMenuOpen && displayedAtFileResults.length > 0) {
          acceptAtFile(displayedAtFileResults[atFileSelectedIndex]);
          return true;
        }
        return false;
      }
      if (intent.kind === "arrow-up" || intent.kind === "arrow-down") {
        const delta = intent.kind === "arrow-up" ? -1 : 1;
        if (slashMenuOpen && slashRows.length > 0) {
          setSlashSelectedIndex((i) => clampIndex(i + delta, slashRows.length));
          return true;
        }
        if (atFileMenuOpen && displayedAtFileResults.length > 0) {
          setAtFileSelectedIndex((i) => clampIndex(i + delta, displayedAtFileResults.length));
          return true;
        }
        return false;
      }
      if (intent.kind === "escape") {
        if (slashMenuOpen) {
          setSlashMenuOpen(false);
          return true;
        }
        if (atFileMenuOpen) {
          setAtFileMenuOpen(false);
          return true;
        }
        return false;
      }
      return false;
    },
    [
      canSend,
      atFileMenuOpen,
      displayedAtFileResults,
      atFileSelectedIndex,
      slashMenuOpen,
      slashRows,
      slashSelectedIndex,
    ],
  );

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const candidates: File[] = [];
    const list = cd.files;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const file = list.item(i);
        if (!file) continue;
        const type = file.type ?? "";
        if (type.startsWith("image/") || type === "") candidates.push(file);
      }
    }
    if (candidates.length === 0) return;
    e.preventDefault();
    void addAttachments(candidates);
  };

  const handleFilePicker = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list.item(i);
      if (file) files.push(file);
    }
    e.target.value = "";
    if (files.length === 0) return;
    void addAttachments(files);
  };

  const isFileDrag = (e: DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // DataTransferItemList is array-like; types.includes works in modern
    // browsers but we fall back to a loop for the static-source contract.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Use relatedTarget to avoid flicker on child entry/exit.
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const list = e.dataTransfer?.files;
    if (!list) return;
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list.item(i);
      if (file) files.push(file);
    }
    if (files.length === 0) return;
    void addAttachments(files);
  };

  const stripVisible = attachments.length > 0 || overCapNotice !== null;

  return (
    <div className={clsx("pt-1.5", compact ? "px-4 pb-4" : "px-4 pb-4")}>
      <div
        className={clsx(
          "mx-auto w-full rounded-xl border",
          compact ? "max-w-2xl" : "max-w-5xl",
          hardDisabled ? "opacity-50" : "",
        )}
        style={{ borderColor: "var(--border)", background: hardDisabled ? "var(--muted)" : "var(--card)" }}
        data-dragging={isDragging || undefined}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {stripVisible && (
          <div
            data-testid="composer-attachment-strip"
            className="px-3 pt-2.5 flex flex-wrap gap-1.5 items-center"
          >
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative size-14 rounded-md overflow-hidden border"
                style={{ borderColor: "var(--border)" }}
                data-testid="composer-attachment-thumb"
              >
                <img
                  src={att.previewUrl}
                  alt={att.filename}
                  title={att.filename}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  aria-label={`Remove ${att.filename}`}
                  className="absolute top-0.5 right-0.5 size-4 rounded-full bg-black/70 text-white text-[10px] grid place-items-center"
                >
                  ×
                </button>
              </div>
            ))}
            {overCapNotice !== null && (
              <div
                role="status"
                aria-live="polite"
                className="text-[11px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {overCapNotice}
              </div>
            )}
          </div>
        )}
        <div className="pl-3 pr-2 py-2.5 relative">
          {atFileMenuOpen && (
            <ComposerAtFileMenu
              items={displayedAtFileResults}
              selectedIndex={atFileSelectedIndex}
              onHover={setAtFileSelectedIndex}
              onSelect={acceptAtFile}
              loading={atFileLoading}
              query={atFileQuery}
            />
          )}
          {slashMenuOpen && (
            <ComposerSlashMenu
              query={slashMenuQuery}
              slashCommands={slashCommands ?? null}
              selectedIndex={slashSelectedIndex}
              onHover={setSlashSelectedIndex}
              onSelect={acceptSlash}
            />
          )}
          {/* Editor takes the row; the settings gear sits at the top-right,
              its right edge on the same vertical axis as the send/stop
              button below (both anchored to the pr-2 gutter). */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <ComposerEditor
                ref={editorRef}
                disabled={hardDisabled}
                placeholder={
                  hardDisabled
                    ? disabledReason ?? "Locked — resolve above"
                    : isQueueMode
                      ? "Queue a follow-up for Claude… (Shift+Enter for new line)"
                      : COMPOSER_PLACEHOLDER
                }
                onStateChange={handleEditorStateChange}
                onKeyIntent={handleKeyIntent}
                onPaste={handlePaste}
              />
            </div>
            <button
              type="button"
              onClick={() => onOpenSettings?.()}
              className="size-7 shrink-0 rounded-md grid place-items-center hover:bg-[var(--accent)]"
              style={{ color: "var(--muted-foreground)" }}
              title="Chat settings"
              aria-label="Chat settings"
              data-testid="chat-settings-gear"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 014 17.93l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9.9a1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 016.07 4l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 009.1 2.91V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06A2 2 0 0119.93 7l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.27.66.92 1.09 1.65 1.09H21a2 2 0 010 4h-.09c-.73 0-1.38.43-1.65 1.09z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-2 pb-2 flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            hidden
            onChange={handleFilePicker}
            data-testid="composer-file-input"
          />
          <button
            type="button"
            disabled={hardDisabled}
            onClick={() => fileInputRef.current?.click()}
            className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
            style={{ color: "var(--muted-foreground)" }}
            title="Attach image"
            aria-label="Attach image"
            data-testid="composer-paperclip-button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
              <path d="M21.4 11l-9 9a5.7 5.7 0 01-8-8l9-9a3.8 3.8 0 015.4 5.4l-9 9a1.9 1.9 0 11-2.7-2.7L15 7" />
            </svg>
          </button>
          <ComposerFooterToolbar
            workspace={
              vcsKind !== undefined && defaultEnvMode !== undefined ? (
                <WorkspacePill
                  repoName={repoName ?? null}
                  branch={branch ?? null}
                  vcsKind={vcsKind === "git" ? "git" : "unknown"}
                  worktreeMode={worktreeMode ?? null}
                  defaultEnvMode={defaultEnvMode}
                />
              ) : null
            }
            contextUsage={<ContextUsageIndicator usage={contextUsage ?? null} />}
            sendButton={
              <>
                {isInterrupted && (
                  <span
                    role="status"
                    aria-label="Interrupted. Send a message to continue from where Claude paused."
                    title="Send a message to continue from where Claude paused."
                    className="ml-1 text-[10px] font-mono rounded px-1.5 py-0.5 bg-amber-700 text-amber-100"
                    style={{
                      background: "var(--warning, #b45309)",
                      color: "var(--warning-foreground, #fef3c7)",
                    }}
                    data-testid="interrupted-pill"
                  >
                    Interrupted
                  </span>
                )}
                {isRunning && onInterrupt && (
                  <button
                    type="button"
                    onClick={onInterrupt}
                    className="ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm"
                    style={{ background: "var(--destructive)" }}
                    title="Interrupt the running turn"
                    aria-label="Stop"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                )}
                {!hardDisabled && !isQueueMode && (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={!canSend || isOffline}
                    className={clsx(
                      "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                      (!canSend || isOffline) && "opacity-50",
                    )}
                    style={{ background: "var(--primary)" }}
                    title="Send (Enter)"
                    aria-label={
                      isOffline
                        ? `Send disabled — ${disabledReason ?? "disconnected"}`
                        : "Send message"
                    }
                    data-testid="composer-send-button"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3.5">
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
                {!hardDisabled && isQueueMode && (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={!canSend || isOffline}
                    className={clsx(
                      "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                      (!canSend || isOffline) && "opacity-50",
                    )}
                    style={{ background: "var(--primary)" }}
                    title="Queue (Enter) — pushes ahead of the running turn"
                    aria-label={
                      isOffline
                        ? `Queue disabled — ${disabledReason ?? "disconnected"}`
                        : "Queue message"
                    }
                    data-testid="composer-queue-button"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3.5">
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </>
            }
          />
        </div>
        {isOffline && disabledReason && (
          <div
            role="status"
            aria-live="polite"
            className="px-3 pb-2 text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
            data-testid="composer-offline-hint"
          >
            {disabledReason}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * MIME-resolution strategy:
 *   1. If `file.type` already starts with `image/`, trust it.
 *   2. Otherwise (blank-type case, common for clipboard paste in some
 *      browsers) sniff the first 12 bytes against the four supported
 *      magic-byte signatures: PNG / JPEG / GIF / WebP.
 *   3. Fallback to `image/png` so the bridge accepts the bytes.
 */
async function resolveMediaType(file: File): Promise<string> {
  const declared = file.type ?? "";
  if (declared.startsWith("image/")) return declared;
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    // PNG: 89 50 4E 47
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return "image/png";
    }
    // JPEG: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return "image/jpeg";
    }
    // GIF: 47 49 46 38 ("GIF8")
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
      return "image/gif";
    }
    // WebP: 52 49 46 46 .. .. .. .. 57 45 42 50 ("RIFF....WEBP")
    if (
      head[0] === 0x52 &&
      head[1] === 0x49 &&
      head[2] === 0x46 &&
      head[3] === 0x46 &&
      head[8] === 0x57 &&
      head[9] === 0x45 &&
      head[10] === 0x42 &&
      head[11] === 0x50
    ) {
      return "image/webp";
    }
  } catch {
    // Fall through to the default below.
  }
  return "image/png";
}

/**
 * Read a held `ComposerAttachment` as `data:<mt>;base64,<b64>` at
 * submit time. Strip the prefix and return the {@link UserTurnImage}
 * wire shape. Done at submit time (not attach time) — the composer
 * state holds the original `File` until send.
 */
function encodeAttachment(att: ComposerAttachment): Promise<UserTurnImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not yield a string"));
        return;
      }
      const commaIdx = result.indexOf(",");
      const dataB64 = commaIdx === -1 ? result : result.slice(commaIdx + 1);
      resolve({
        mediaType: att.mediaType,
        dataB64,
        filename: att.filename,
      });
    };
    reader.readAsDataURL(att.file);
  });
}

/**
 * Local nanoid replacement — keeps `ChatComposer` free of new deps. The
 * id is only used as a React key and as the lookup token for
 * `removeAttachment`; randomness is sufficient.
 */
function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function clampIndex(next: number, length: number): number {
  if (length <= 0) return 0;
  return ((next % length) + length) % length;
}
