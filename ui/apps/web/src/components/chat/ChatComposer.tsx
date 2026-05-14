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

/**
 * T-007 / US-007. Three-state composer policy mirror — kept in sync
 * with `routes/live-chat.tsx`'s `ComposerMode` type. The composer
 * uses this to split hard-disable (blocked) from queue-while-running
 * (queue) from default-enabled (ready).
 */
export type ComposerMode = "ready" | "queue" | "blocked";

export interface ChatComposerProps {
  /**
   * T-007 / US-007. Three-state composer policy. The composer
   * hard-disables iff `composerMode === "blocked"`; the queue mode
   * changes the send affordance (label / title says "Queue") but
   * keeps the textarea + button enabled so the user can push a
   * follow-up while the turn streams. Optional for backwards-compat
   * during a transition window — when omitted the composer falls
   * back to the legacy `disabled` boolean derivation.
   */
  composerMode?: ComposerMode;
  /** Disabled when there is a pending AskUserQuestion or PermissionRequest. */
  disabled?: boolean;
  disabledReason?: string;
  /** Compact narrows for the worktree-mode pane. */
  compact?: boolean;
  /**
   * US-006 / T-010. Submit handler. Always receives `images` as an
   * array (empty when no attachments are held). The composer no
   * longer exposes a queue-priority selector — every submit is the
   * default "now" priority on the wire.
   */
  onSubmit?: (text: string, images: UserTurnImage[]) => void;
  /** When true, the running turn is interruptable — shows a stop button. */
  isRunning?: boolean;
  onInterrupt?: () => void;

  /**
   * US-004. Permission-mode selector (always visible). The parent
   * supplies the current mode + the dispatcher; the composer emits the
   * selected mode through `onPermissionModeChange` and the route
   * forwards it to the bridge via a `permission-mode-set` frame.
   */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;

  /**
   * US-005. When true (parent derives from `turnState === "interrupted"`)
   * the composer renders a distinct amber "Interrupted" pill adjacent
   * to the Stop/Send control. The pill is informational; the SDK's
   * implicit re-prime resumes the cancelled turn when the next user
   * message arrives via `UserMessageQueue`.
   */
  isInterrupted?: boolean;

  /**
   * T-013 / US-008. Chat's current working directory — forwarded to the
   * `/file-search` endpoint for the `@`-file picker. When undefined the
   * fetch is skipped and the menu can still render an empty / loading
   * state.
   */
  cwd?: string;

  /**
   * T-007 / US-001..US-006. Bridge-supplied slash-command catalog
   * delivered via the `slash-commands-update` frame and routed through
   * {@link useChatBridge}. `null` until the first frame lands (drives
   * the ADR-D02 "Loading commands…" affordance under the PROVIDER
   * header). Built-in rows are merged client-side inside
   * {@link ComposerSlashMenu}.
   */
  slashCommands?: WireSlashCommand[] | null;
}

/**
 * T-005 / US-001..US-005. One held attachment inside the composer.
 * The `file` field is the original `File` (used for submit-time base64
 * encode); `previewUrl` is a `URL.createObjectURL(file)` blob URL used
 * exclusively for the in-composer thumbnail (revoked on remove, on
 * post-submit clear, and on unmount). `mediaType` is the sniffed /
 * declared MIME (defaults to image/png per US-001 AC3 when blank).
 */
interface ComposerAttachment {
  id: string;
  file: File;
  mediaType: string;
  previewUrl: string;
  filename: string;
}

/**
 * Inline SVG icons paired with each permission mode. We use raw SVGs
 * (no `lucide-react` dep) for parity with the rest of the composer
 * footer (paperclip, send-arrow, stop, …). Each icon takes a single
 * `className` so the caller can size / colour it via Tailwind utilities;
 * `currentColor` keeps the stroke in sync with the surrounding text
 * colour so the ghost-button hover treatment "just works".
 */
export type ModeIconProps = { className?: string };

export function ShieldIcon({ className }: ModeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function ClipboardListIcon({ className }: ModeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M8 12h.01M12 12h4M8 16h.01M12 16h4" />
    </svg>
  );
}

export function PenLineIcon({ className }: ModeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function LockOpenIcon({ className }: ModeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function ChevronDownIcon({ className }: ModeIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * Permission-mode catalog. The `value` field carries the SDK literal
 * (it ships on the wire byte-for-byte via `permission-mode-set`); the
 * `label` and `description` are the human-readable strings shown in
 * the composer UI. The mapping mirrors the t3code runtime-mode vocab
 * (Supervised / Auto-accept edits / Full access) plus the Claude-Code-
 * specific "Plan" mode, so the user never sees an SDK slug like
 * `bypassPermissions`. The icon is rendered on the ghost trigger so
 * the current mode is scannable at a glance.
 */
interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  description: string;
  Icon: (props: ModeIconProps) => JSX.Element;
}

const PERMISSION_MODES: ReadonlyArray<PermissionModeOption> = [
  {
    value: "default",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    Icon: ShieldIcon,
  },
  {
    value: "plan",
    label: "Plan",
    description: "Draft a plan without executing anything.",
    Icon: ClipboardListIcon,
  },
  {
    value: "acceptEdits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    Icon: PenLineIcon,
  },
  {
    value: "bypassPermissions",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    Icon: LockOpenIcon,
  },
];

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
  permissionMode = "default",
  onPermissionModeChange,
  isInterrupted,
  cwd,
  slashCommands,
}: ChatComposerProps) {
  // T-007 / US-007. Resolve the hard-disable + send-affordance flags
  // from the three-state composer mode. When `composerMode` is
  // omitted the legacy `disabled` boolean is the only signal — that
  // path keeps the pre-T-007 behaviour for any caller that hasn't
  // adopted the new prop yet.
  const isBlocked = composerMode === "blocked";
  const isQueueMode = composerMode === "queue";
  const hardDisabled = isBlocked || !!disabled;
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const handleEditorStateChange = useCallback((state: { text: string; cursor: number }) => {
    setValue(state.text);
    setCursor(state.cursor);
  }, []);
  const editorRef = useRef<ComposerEditorHandle | null>(null);

  // T-005. Attachment state machine. The `attachmentsRef` mirror is
  // read by the unmount cleanup so we can revoke object URLs without
  // listing `attachments` in the effect's dependency array (which would
  // re-fire the cleanup on every add/remove and double-revoke).
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [overCapNotice, setOverCapNotice] = useState<string | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  attachmentsRef.current = attachments;
  const overCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // T-008. Drag state for the data-dragging highlight. The container
  // toggles a `data-dragging` attribute that CSS keys off.
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // T-007. Hidden file-picker input ref.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // T-013. Parallel @-file menu state (per ADR-D06). Runs alongside the
  // slash-menu state above; the mutual-exclusion guard below ensures
  // only one menu opens at a time.
  const [atFileMenuOpen, setAtFileMenuOpen] = useState(false);
  const [atFileSelectedIndex, setAtFileSelectedIndex] = useState(0);
  const [atFileQuery, setAtFileQuery] = useState("");
  const [atFileResults, setAtFileResults] = useState<string[]>([]);
  const [atFileLoading, setAtFileLoading] = useState(false);
  const atFileTriggerRef = useRef<{ rangeStart: number; rangeEnd: number } | null>(null);

  // T-007 / US-001. Slash-menu state machine. Detection runs on every
  // (value, cursor) update; the menu opens whenever the editor matches
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

  // T-005. Unmount cleanup — revoke every previewUrl we still hold.
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

  // T-007 / US-001 AC1 + US-003 AC4. Accept a slash-menu row. SDK
  // provider rows (and skills) write `/<name> ` into the textarea at
  // the trigger range — mirrors the prior generic behaviour so the
  // user lands one keystroke away from arguments. Built-in row click
  // handlers (`/model` → picker, `/plan` / `/default` →
  // `permission-mode-set`) are out of scope for this task — T-008 and
  // T-010 land them; for now built-ins use the same generic path so
  // the menu doesn't render an inert row.
  const acceptSlash = (row: SlashMenuRow) => {
    const trigger = slashTriggerRef.current;
    if (!trigger) return;
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

  const onPermissionSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onPermissionModeChange) return;
    const next = e.target.value as PermissionMode;
    onPermissionModeChange(next);
  };

  const stripVisible = attachments.length > 0 || overCapNotice !== null;

  // Resolve the active permission-mode option for the ghost trigger.
  // Falls back to the first entry (Supervised) when the prop carries an
  // unknown SDK value — that should never happen in practice but keeps
  // the trigger from rendering an empty pill if the wire ever drifts.
  const activeModeOption =
    PERMISSION_MODES.find((m) => m.value === permissionMode) ?? PERMISSION_MODES[0];
  const ActiveModeIcon = activeModeOption.Icon;

  return (
    <div className={clsx("pt-1.5", compact ? "px-4 pb-4" : "px-5 pb-5")}>
      <div
        className={clsx(
          "mx-auto rounded-xl border",
          compact ? "max-w-2xl" : "max-w-3xl",
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
        <div className="px-3 py-2.5 relative">
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
            modelSelector={<div data-testid="composer-pill-model-selector" />}
            modelSettings={<div data-testid="composer-pill-model-settings" />}
            buildPlanToggle={<div data-testid="composer-pill-build-plan" />}
            permissionLevel={
              <div data-testid="composer-pill-permission-level">
                {/* Placeholder until T-013 lands the real PermissionLevelPill.
                    Carries the active mode tuple so dependent code paths
                    (live-chat reducer, integration smoke) stay live. */}
                <span hidden>
                  {permissionMode}
                  {String(!!onPermissionModeChange)}
                </span>
              </div>
            }
            contextUsage={<div data-testid="composer-pill-context-usage" />}
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
                    disabled={!canSend}
                    className={clsx(
                      "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                      !canSend && "opacity-50",
                    )}
                    style={{ background: "var(--primary)" }}
                    title="Send (Enter)"
                    aria-label="Send message"
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
                    disabled={!canSend}
                    className={clsx(
                      "ml-2 size-7 rounded-md grid place-items-center text-white shadow-sm",
                      !canSend && "opacity-50",
                    )}
                    style={{ background: "var(--primary)" }}
                    title="Queue (Enter) — pushes ahead of the running turn"
                    aria-label="Queue message"
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
      </div>
    </div>
  );
}

/**
 * T-005 / US-001 AC3. MIME-resolution strategy:
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
 * T-010. Read a held `ComposerAttachment` as `data:<mt>;base64,<b64>` at
 * submit time. Strip the prefix and return the UserTurnImage wire shape.
 * Done at submit time (not attach time) per B-14 / ADR-D05 — the
 * composer state holds the original `File` until send.
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
