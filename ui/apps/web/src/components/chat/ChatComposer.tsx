import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import clsx from "clsx";
import type { PermissionMode, UserTurnImage } from "../../lib/chat-types";
import type { SlashCommandEntry } from "../../lib/api";
import {
  detectAtFileTrigger,
  detectSlashCommandTrigger,
  rankSlashCommands,
  replaceTextRange,
} from "../../lib/composer-trigger";
import { ComposerAtFileMenu } from "./ComposerAtFileMenu";
import { ComposerSlashMenu } from "./ComposerSlashMenu";

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
   * Slash-command catalog (user + project + plugin scope) used to drive
   * the inline `/`-trigger menu. When omitted or empty the menu stays
   * hidden — the composer still accepts `/foo` as plain text so Claude
   * Code can execute it server-side.
   */
  availableSlashCommands?: SlashCommandEntry[];

  /**
   * T-013 / US-008. Chat's current working directory — forwarded to the
   * `/file-search` endpoint for the `@`-file picker. When undefined the
   * fetch is skipped and the menu can still render an empty / loading
   * state.
   */
  cwd?: string;
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
  availableSlashCommands,
  cwd,
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
  const [menuSelectedIndex, setMenuSelectedIndex] = useState(0);
  // Escape-dismissed trigger key. The menu re-opens only when the user
  // edits the trigger (changing its query / range), so the same
  // dismissed `/foo` stays closed until the user types or moves on.
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

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

  // Slash-trigger detection runs on every (value, cursor) update; the
  // menu is hidden when the trigger is null, no commands match, or the
  // user has Escape-dismissed this exact trigger.
  const slashTrigger = useMemo(
    () => (hardDisabled ? null : detectSlashCommandTrigger(value, cursor)),
    [value, cursor, hardDisabled],
  );
  const filteredCommands = useMemo(() => {
    if (!slashTrigger) return [];
    if (!availableSlashCommands || availableSlashCommands.length === 0) return [];
    return rankSlashCommands(availableSlashCommands, slashTrigger.query);
  }, [slashTrigger, availableSlashCommands]);
  const currentTriggerKey = triggerKey(slashTrigger);
  const slashMenuOpen =
    !!slashTrigger &&
    filteredCommands.length > 0 &&
    currentTriggerKey !== dismissedTriggerKey;

  // T-013. @-file detection runs on every (value, cursor) update too,
  // gated behind the mutual-exclusion guard so the slash menu wins when
  // both detectors fire on the same tick (B-13).
  const atTrigger = useMemo(
    () => (hardDisabled ? null : detectAtFileTrigger(value, cursor)),
    [value, cursor, hardDisabled],
  );

  // Dev-only warning when both detectors return non-null on the same
  // tick — early signal that one of the two detectors has drifted.
  useEffect(() => {
    if (slashTrigger && atTrigger) {
      console.warn(
        "[ChatComposer] both slash- and @-file triggers active on the same tick — slash wins",
        { slashQuery: slashTrigger.query, atQuery: atTrigger.query },
      );
    }
  }, [slashTrigger, atTrigger]);

  // Open / close the @-menu in response to the trigger + guard.
  useEffect(() => {
    if (slashMenuOpen) {
      // Mutual-exclusion: slash menu wins.
      if (atFileMenuOpen) {
        setAtFileMenuOpen(false);
        setAtFileResults([]);
        setAtFileQuery("");
      }
      return;
    }
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
  }, [atTrigger, slashMenuOpen, atFileMenuOpen, atFileQuery]);

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
      const url = `/file-search?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(atFileQuery)}`;
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

  // Clamp/reset slash-menu selection when the filtered list changes.
  useEffect(() => {
    if (filteredCommands.length === 0) {
      if (menuSelectedIndex !== 0) setMenuSelectedIndex(0);
      return;
    }
    if (menuSelectedIndex >= filteredCommands.length) {
      setMenuSelectedIndex(0);
    }
  }, [filteredCommands, menuSelectedIndex]);

  // Clear the slash Escape-dismiss latch once the user moves off the
  // dismissed trigger.
  useEffect(() => {
    if (dismissedTriggerKey !== null && currentTriggerKey !== dismissedTriggerKey) {
      setDismissedTriggerKey(null);
    }
  }, [currentTriggerKey, dismissedTriggerKey]);

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

  const acceptCommand = (item: SlashCommandEntry) => {
    if (!slashTrigger) return;
    const { text, cursor: nextCursor } = replaceTextRange(
      value,
      slashTrigger.rangeStart,
      slashTrigger.rangeEnd,
      `/${item.name} `,
    );
    setValue(text);
    setCursor(nextCursor);
    queueMicrotask(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try {
        ta.setSelectionRange(nextCursor, nextCursor);
      } catch {}
    });
  };

  const acceptAtFile = (path: string) => {
    const trigger = atFileTriggerRef.current;
    if (!trigger) return;
    const { text, cursor: nextCursor } = replaceTextRange(
      value,
      trigger.rangeStart,
      trigger.rangeEnd,
      `@${path} `,
    );
    setValue(text);
    setCursor(nextCursor);
    setAtFileMenuOpen(false);
    setAtFileResults([]);
    setAtFileQuery("");
    queueMicrotask(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try {
        ta.setSelectionRange(nextCursor, nextCursor);
      } catch {}
    });
  };

  const submit = async () => {
    const text = value.trim();
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments) return;
    if (!onSubmit) return;
    const images = await Promise.all(attachments.map(encodeAttachment));
    onSubmit(text, images);
    // Post-submit cleanup: revoke + clear, third URL.revokeObjectURL
    // call site per US-005 AC3.
    for (const att of attachments) {
      URL.revokeObjectURL(att.previewUrl);
    }
    setAttachments([]);
    setValue("");
    setCursor(0);
    setDismissedTriggerKey(null);
    queueMicrotask(() => taRef.current?.focus());
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuSelectedIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = filteredCommands[menuSelectedIndex] ?? filteredCommands[0];
        if (item) acceptCommand(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedTriggerKey(currentTriggerKey);
        return;
      }
    }
    if (atFileMenuOpen && atFileResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtFileSelectedIndex((i) => (i + 1) % atFileResults.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtFileSelectedIndex((i) => (i - 1 + atFileResults.length) % atFileResults.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const path = atFileResults[atFileSelectedIndex] ?? atFileResults[0];
        if (path) acceptAtFile(path);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtFileMenuOpen(false);
        setAtFileResults([]);
        setAtFileQuery("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void submit();
    }
  };

  // Track the textarea selection so trigger detection sees the live
  // cursor.
  const syncCursorFromTa = () => {
    const ta = taRef.current;
    if (!ta) return;
    const next = ta.selectionStart ?? 0;
    if (next !== cursor) setCursor(next);
  };

  const onPermissionSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (!onPermissionModeChange) return;
    const next = e.target.value as PermissionMode;
    onPermissionModeChange(next);
  };

  const stripVisible = attachments.length > 0 || overCapNotice !== null;
  const canSend = value.trim().length > 0 || attachments.length > 0;

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
          {slashMenuOpen && (
            <ComposerSlashMenu
              items={filteredCommands}
              selectedIndex={menuSelectedIndex}
              onHover={setMenuSelectedIndex}
              onSelect={acceptCommand}
            />
          )}
          {atFileMenuOpen && !slashMenuOpen && (
            <ComposerAtFileMenu
              items={atFileResults}
              selectedIndex={atFileSelectedIndex}
              onHover={setAtFileSelectedIndex}
              onSelect={acceptAtFile}
              loading={atFileLoading}
            />
          )}
          <textarea
            ref={taRef}
            rows={2}
            disabled={hardDisabled}
            placeholder={hardDisabled ? disabledReason ?? "Locked — resolve above" : isQueueMode ? "Queue a follow-up for Claude… (Shift+Enter for new line)" : "Reply to Claude… (Shift+Enter for new line)"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCursor(e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCursorFromTa}
            onSelect={syncCursorFromTa}
            onClick={syncCursorFromTa}
            onPaste={handlePaste}
            className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-[var(--muted-foreground)]/60"
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
          {!compact && (
            <>
              <span
                className="inline-flex items-center gap-1 text-[10px] font-mono"
                style={{ color: "var(--muted-foreground)" }}
                title="Type / at the start of a line to see commands"
              >
                <span className="font-mono">/</span>
                <span>commands</span>
              </span>
              {/*
               * Vertical hairline separator. Mirrors t3code's footer
               * vocabulary — controls are divided by 1px dividers
               * rather than by their own borders, so the row reads as
               * a single horizontal toolbar instead of a row of boxed
               * inputs. Decorative; hidden from AT.
               */}
              <span
                aria-hidden="true"
                className="mx-0.5 h-3.5 w-px"
                style={{ background: "var(--border)" }}
              />
            </>
          )}
          <span className="flex-1" />
          {/*
           * US-004. Permission-mode selector. Ghost-styled trigger
           * (icon + friendly label + chevron) over an invisible native
           * `<select>` that handles keyboard, popup and option list.
           * Native semantics, custom paint — the same trick the rest
           * of the composer uses for the paperclip / send affordances.
           *
           * Labels are the friendly t3code-style strings (Supervised /
           * Plan / Auto-accept edits / Full access) rather than the
           * SDK slugs the wire carries — slug → friendly mapping lives
           * in `PERMISSION_MODES`.
           *
           * Always visible regardless of turn state so the user can
           * pre-set the mode for the next turn while one is still
           * streaming.
           */}
          <span
            className={clsx(
              "relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
              !hardDisabled && onPermissionModeChange && "cursor-pointer hover:bg-[var(--accent)]",
            )}
            style={{ color: "var(--muted-foreground)" }}
            title={activeModeOption.description}
          >
            <ActiveModeIcon className="size-3.5" />
            <span>{activeModeOption.label}</span>
            <ChevronDownIcon className="size-3 opacity-60" />
            <select
              value={permissionMode}
              onChange={onPermissionSelectChange}
              disabled={hardDisabled || !onPermissionModeChange}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              aria-label="Permission mode"
              data-testid="permission-mode-select"
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} — {m.description}
                </option>
              ))}
            </select>
          </span>
          {/* Hairline between mode and the trailing send / stop / pill cluster. */}
          <span
            aria-hidden="true"
            className="mx-0.5 h-3.5 w-px"
            style={{ background: "var(--border)" }}
          />
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
              className="ml-2 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-white shadow-sm"
              style={{ background: "var(--destructive)" }}
              title="Interrupt the running turn"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop
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
                "ml-2 inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-white shadow-sm",
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
              <span>Queue</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function triggerKey(
  t: { query: string; rangeStart: number; rangeEnd: number } | null,
): string | null {
  if (!t) return null;
  return `${t.rangeStart}:${t.rangeEnd}:${t.query}`;
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
