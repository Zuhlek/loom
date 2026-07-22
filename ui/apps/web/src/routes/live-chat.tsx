/**
 * LiveChatRoute — opens a WebSocket to /ws, sends an `attach` frame for
 * the chat-id, and renders the structured chat surface (MessagesTimeline
 * + ChatComposer). No PTY, no xterm — Claude is driven through the
 * Agent SDK on the server, which emits typed items the client renders
 * directly.
 *
 * Reconnect logic: if the socket closes while the route is mounted we
 * retry every 1 s up to ~10 s. On reconnect the server sends a fresh
 * snapshot so we don't accumulate stale state.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import clsx from "clsx";

import { AppLayout } from "../components/layout/AppLayout";
import { LiveSidebar } from "../components/LiveSidebar";
import { TasksPanel, type Task } from "../components/TasksPanel";
import { DiffPanelContainer } from "../components/diff/DiffPanelContainer";
import { ProjectWorktreesPanel } from "../components/worktrees/ProjectWorktreesPanel";
import { MessagesTimeline } from "../components/chat/MessagesTimeline";
import { QuestionNav } from "../components/chat/QuestionNav";
import { ImageLightbox, useLightbox } from "../components/chat/ImageLightbox";
import { collectUserImages } from "../lib/chat-images";
import { deriveTimelineRows } from "../lib/timeline-rows";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatSettingsModal } from "../components/chat/ChatSettingsModal";
import { PermissionRequestInline } from "../components/chat/PermissionRequestInline";
import { AskUserQuestionPicker } from "../components/chat/AskUserQuestionPicker";
import { useSnackbar } from "../components/ui/Snackbar";
import { SessionRecoveryBanner } from "../components/chat/SessionRecoveryBanner";
import { ConnectionBanner } from "../components/chat/ConnectionBanner";
import {
  errorText,
  forkChat,
  getChat,
  getSettings,
  handoffChat,
  renameChat,
  wsUrl,
  type ApiChat,
  type ModelOption,
} from "../lib/api";
import { useChatBridge } from "../lib/use-chat-bridge";
import { useSidebarState } from "../lib/sidebar-state";
import type {
  ChatItem,
  ClientFrame,
  ConnState,
  PendingPermission,
  PendingQuestion,
  PermissionMode,
  ServerFrame,
  SessionLifecycle,
  TurnState,
  UserMessageImage,
  UserMessageItem,
  UserTurnImage,
  WireModelSettings,
} from "../lib/chat-types";

interface Props {
  chatId: string;
}

/**
 * Composer policy selector. Returns a three-state value the composer
 * uses to distinguish "queued while running" from "hard-blocked by a
 * pending tool gate":
 *
 *   - `"ready"`   : composer enabled; submit goes through immediately.
 *                   Includes `idle`, `interrupted`, `error` — the
 *                   `"interrupted"` case relies on claude's implicit
 *                   re-prime when the next input arrives.
 *   - `"queue"`   : composer enabled but a turn is in flight. Send
 *                   button surfaces as "Queue"; submits are appended
 *                   to the tmux input stream so claude consumes them
 *                   after the active turn settles.
 *   - `"blocked"` : a pending permission or AskUserQuestion is open;
 *                   the composer hard-disables (textarea, attachments,
 *                   AND send) until the user resolves the inline picker
 *                   / permission card. The only meaningful next action
 *                   is resolving the gate, so nothing else is editable.
 *   - `"offline"` : the raw WebSocket is not `open` (connecting / closed
 *                   / idle) and no tool gate is pending. The composer
 *                   stays EDITABLE so the user can keep typing / drafting
 *                   through a transient reconnect (the route retries
 *                   ~1s for up to ~10s), but the SEND action is disabled
 *                   and a connection reason is surfaced ("Connecting…" /
 *                   "Connection lost — reconnecting…"). Without this, a
 *                   send would be silently dropped by `submitTurn`'s
 *                   `ws.OPEN` guard after clearing the composer. NOTE:
 *                   this gates on the RAW SOCKET only — a session
 *                   "recovering" while the socket stays `open` is NOT
 *                   offline here, because F1's server-side readiness
 *                   queue holds the turn until the session is back.
 *
 * Precedence (most specific first):
 *   1. pendingPermission OR pendingQuestion → `"blocked"` (a tool gate
 *      is open; resolving it is the only meaningful next action — this
 *      wins even when the socket is also down).
 *   2. else `conn !== "open"` → `"offline"` (raw socket not open;
 *      stay editable, disable send + show reason).
 *   3. else `turnState === "running"` → `"queue"`.
 *   4. else → `"ready"`.
 *
 * `conn` is optional and treated as `"open"` when absent so pure
 * connection-agnostic callers/tests keep their existing semantics.
 *
 * Exported so the static-source contract tests can import it directly
 * and verify the selector behaviour; pure (depends only on the supplied
 * state fields).
 */
export type ComposerMode = "ready" | "queue" | "blocked" | "offline";

/**
 * Maximum wait between the `attached` and `snapshot` frames. If the
 * server accepts our attach but never delivers a snapshot — e.g. the
 * tmux pane was spawned but JSONL discovery is wedged — we surface a
 * diagnostic banner instead of silently rendering an empty timeline.
 */
const SNAPSHOT_TIMEOUT_MS = 15_000;

/**
 * F2 — how long an optimistic user bubble may stay `"sending"` before
 * the watchdog marks it `"failed"`. Deliberately generous: with the F1
 * server-side readiness gate a cold-start send is queued and only
 * echoed once the bridge reaches `running` (up to ~10 s), so a tighter
 * timer would flash a false "Failed to send" on a perfectly healthy
 * cold start. The primary failure signal is the `turn-state`
 * error/interrupted transition (handled in the reducer); this timer is
 * the backstop for a send that silently never echoes at all (e.g. the
 * socket dropped right after the frame left).
 */
const OPTIMISTIC_PENDING_TIMEOUT_MS = 45_000;

export function composerMode(state: {
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
  turnState: TurnState;
  /**
   * Raw WebSocket connection state. Optional: absent is treated as
   * `"open"` so connection-agnostic callers/tests retain the legacy
   * permission/question/turn-only semantics.
   */
  conn?: ConnState;
}): ComposerMode {
  if (state.pendingPermission || state.pendingQuestion) return "blocked";
  if (state.conn !== undefined && state.conn !== "open") return "offline";
  if (state.turnState === "running") return "queue";
  return "ready";
}

export interface ChatState {
  items: ChatItem[];
  itemsById: Record<string, number>;
  turnState: TurnState;
  /**
   * Sticky error banner state. Survives `snapshot` resets; only
   * overwritten when a NEW error arrives (different message), and
   * only hidden when the user explicitly dismisses. The banner
   * renders iff `error && !error.dismissed`.
   */
  error: { message: string; dismissed: boolean } | null;
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
  /** Current SDK permission mode driving the composer dropdown. */
  permissionMode: PermissionMode;
  /**
   * Millisecond epoch when the active turn entered the `running`
   * state. `null` whenever `turnState` is not `"running"`. Consumed
   * by `<WorkingChip>` (via `<MessagesTimeline>`) to drive the
   * "Working for Xs" elapsed counter. Set on the idle→running
   * transition; preserved across multiple SDK messages within one
   * turn (running→running); cleared on any transition out of
   * `"running"`.
   */
  activeTurnStartedAt: number | null;
  /**
   * Session-lifetime resilience state mirrored from the server bridge.
   * Drives `SessionRecoveryBanner` and gates the legacy
   * `ChatErrorBanner` (suppressed during recovery to avoid stacking).
   * Defaults to `"active"`; the server emits `session-state` frames
   * (or snapshot fields) when the SDK loop crashes and the bridge
   * starts auto-respawning.
   */
  lifecycle: SessionLifecycle;
  /** Auto-respawn counter for the current failure streak. */
  recoveryAttempt: number;
}

export const EMPTY_STATE: ChatState = {
  items: [],
  itemsById: {},
  turnState: "idle",
  error: null,
  pendingPermission: null,
  pendingQuestion: null,
  permissionMode: "default",
  // Set by the reducer's `turn-state` branch on the idle→running
  // transition; never set elsewhere. Initial value `null` because
  // EMPTY_STATE represents the pre-attach state where no turn is
  // running.
  activeTurnStartedAt: null,
  lifecycle: "active",
  recoveryAttempt: 0,
};

/**
 * Id prefix for client-side optimistic user bubbles (F2). Real server
 * item ids never use this scheme, so `isOptimisticId` is a reliable
 * discriminator both for reconciliation (drop the oldest optimistic on a
 * server user-message echo) and for rebuilding `itemsById`.
 */
export const OPTIMISTIC_ID_PREFIX = "optimistic:";

function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/**
 * `true` for an optimistic placeholder still awaiting its server echo
 * ("sending" only). Used by the reconcile path to find the oldest bubble
 * to replace. Excludes "failed": those are reclaimed separately and only
 * on a TEXT match (see `matchesFailedOptimistic`), so a fresh echo can't
 * blindly consume an unrelated stale failed bubble and desync FIFO.
 */
function isPendingUserItem(it: ChatItem): it is UserMessageItem {
  return it.kind === "user-message" && it.pending === "sending";
}

/**
 * A "failed" optimistic bubble whose text matches an incoming server echo.
 * Reclaimed by the reconcile path only when NO "sending" bubble is available:
 * a bubble the watchdog (or a transient turn error/interrupt) marked failed
 * can still get a real echo later — a QUEUED send's `user` line is written
 * only when claude dequeues it, long after the send, by which point the 45s
 * watchdog may already have failed the bubble. Without this, that late echo
 * appends a SECOND bubble and the prompt renders twice.
 *
 * Text-gated so the F2(c') guarantee holds: an UNRELATED message's echo can
 * never steal a failed slot (different text → no match → it appends). Exact
 * match covers the no-image case; `startsWith` tolerates the server appending
 * `@<absPath>` image tokens to the text it echoes back.
 * ponytail: text match, not turn-id — the optimistic bubble has no server
 * turn id to key on until the echo itself arrives.
 */
function matchesFailedOptimistic(it: ChatItem, echoText: string): boolean {
  if (it.kind !== "user-message" || it.pending !== "failed") return false;
  if (!isOptimisticId(it.id)) return false;
  const a = it.text.trim();
  const b = echoText.trim();
  return a.length > 0 && (a === b || b.startsWith(a));
}

/**
 * Reconcile images when a server echo replaces an optimistic bubble.
 * The optimistic item carries inline `dataB64` (rendered instantly, no
 * network round-trip); the server echo carries only the durable staged
 * `id` (see materializer). Replacing the bubble wholesale would drop the
 * inline bytes and leave the thumbnails dependent on the `/chat-image`
 * read-back — a flash at best, a vanish if that resolve is fragile.
 * Merge instead so the live bubble keeps rendering from the inline bytes
 * AND gains the `id` for read-back durability on a later refresh. Same
 * turn ⇒ same images in the same order, so a positional merge is safe.
 */
function reconcileUserImages(echo: UserMessageItem, replaced: ChatItem): UserMessageItem {
  if (replaced.kind !== "user-message" || !replaced.images?.length) return echo;
  const prev = replaced.images;
  if (!echo.images?.length) return { ...echo, images: prev };
  const images = echo.images.map((img, i) =>
    img.dataB64 ? img : { ...img, dataB64: prev[i]?.dataB64 },
  );
  return { ...echo, images };
}

/** Rebuild the `id → index` map after a structural edit to `items`. */
function rebuildItemsById(items: ChatItem[]): Record<string, number> {
  const itemsById: Record<string, number> = {};
  items.forEach((it, i) => {
    itemsById[it.id] = i;
  });
  return itemsById;
}

type ChatAction =
  | { type: "reset" }
  | { type: "snapshot"; payload: ServerFrame & { kind: "snapshot" } }
  | { type: "item-append"; item: ChatItem }
  | { type: "item-update"; item: ChatItem }
  | { type: "turn-state"; state: TurnState; lastError?: string }
  | { type: "pending-permission"; pending: PendingPermission | null }
  | { type: "pending-question"; pending: PendingQuestion | null }
  | { type: "permission-mode"; mode: PermissionMode }
  | { type: "error-frame"; message: string }
  | { type: "dismiss-error" }
  // F2 — optimistic user bubble inserted synchronously on send (before
  // any server round-trip). `item.id` is an `optimistic:<counter>` id and
  // `item.pending === "sending"`.
  | { type: "optimistic-user"; item: UserMessageItem }
  // F2 — mark every still-`"sending"` optimistic bubble as `"failed"`.
  // Fired when the turn ends in error/interruption or the generous
  // pending-timeout elapses, so a placeholder never strands in the
  // "sending" state forever.
  | { type: "fail-pending" }
  | {
      type: "session-state";
      lifecycle: SessionLifecycle;
      recoveryAttempt?: number;
      lastError?: string;
    };

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return EMPTY_STATE;
    case "snapshot": {
      const items = action.payload.body.items;
      const itemsById: Record<string, number> = {};
      items.forEach((it, i) => {
        itemsById[it.id] = i;
      });
      // Sticky error banner survives `snapshot` resets. Overwrite
      // only when the snapshot carries a NEW message (not the one
      // already surfaced); otherwise preserve `state.error` verbatim
      // (including the `dismissed` flag).
      const incoming = action.payload.body.lastError;
      const error =
        incoming && incoming !== state.error?.message
          ? { message: incoming, dismissed: false }
          : state.error;
      // The server now carries the original turn-start timestamp on
      // the snapshot so reconnect / page-refresh keeps the working
      // timer counting from the real start. Fall back to `Date.now()`
      // only when the server omitted the field (older bridges) but
      // still reports `running`. Non-running → `null`.
      const activeTurnStartedAt =
        action.payload.body.turnState === "running"
          ? action.payload.body.turnStartedAt ?? Date.now()
          : null;
      return {
        items,
        itemsById,
        turnState: action.payload.body.turnState,
        error,
        pendingPermission: action.payload.body.pendingPermission ?? null,
        pendingQuestion: action.payload.body.pendingQuestion ?? null,
        // Preserve the locally-selected composer state across snapshots.
        // The server snapshot does not yet carry `permissionMode` — it
        // arrives on the chat row at attach time.
        permissionMode: state.permissionMode,
        activeTurnStartedAt,
        lifecycle: action.payload.body.lifecycle ?? "active",
        recoveryAttempt: action.payload.body.recoveryAttempt ?? 0,
      };
    }
    case "item-append": {
      if (action.item.id in state.itemsById) return state;
      // F2 reconcile: when the server echoes a `user-message`, drop the
      // OLDEST still-pending optimistic placeholder (FIFO) so exactly one
      // bubble survives. We deliberately do NOT match by text — the
      // server may rewrite the text (e.g. appended `@<absPath>` image
      // tokens), so equality would miss. The placeholder is replaced
      // in-place (same array slot the oldest optimistic held) so the
      // real item lands where the user already sees a bubble, avoiding a
      // position jump / flicker.
      if (action.item.kind === "user-message") {
        const echoText = action.item.text;
        // Prefer the oldest still-"sending" bubble (FIFO, text-agnostic —
        // the server may rewrite text). If none is sending, reclaim a
        // matching "failed" bubble: a queued/slow send can echo AFTER the
        // watchdog gave up on it, and appending here would duplicate the
        // prompt on screen.
        const sendingIdx = state.items.findIndex(isPendingUserItem);
        const reclaimIdx =
          sendingIdx !== -1
            ? sendingIdx
            : state.items.findIndex((it) =>
                matchesFailedOptimistic(it, echoText),
              );
        if (reclaimIdx !== -1) {
          const items = state.items.slice();
          items[reclaimIdx] = reconcileUserImages(action.item, state.items[reclaimIdx]);
          return { ...state, items, itemsById: rebuildItemsById(items) };
        }
      }
      const items = state.items.concat(action.item);
      return {
        ...state,
        items,
        itemsById: { ...state.itemsById, [action.item.id]: items.length - 1 },
      };
    }
    case "optimistic-user": {
      // Synchronous local insert on send — appended like any other item
      // so the existing timeline rendering picks it up with no plumbing
      // changes. The `optimistic:<counter>` id can't collide with a
      // server id, so the duplicate-id guard above never trips on it.
      const items = state.items.concat(action.item);
      return {
        ...state,
        items,
        itemsById: { ...state.itemsById, [action.item.id]: items.length - 1 },
      };
    }
    case "fail-pending": {
      // Flip every "sending" placeholder to "failed". No structural
      // change to `items` (ids/indices unchanged), so `itemsById` stays
      // valid. Returns the same reference when nothing was pending so
      // React can bail out of the re-render.
      let changed = false;
      const items = state.items.map((it) => {
        if (it.kind === "user-message" && it.pending === "sending") {
          changed = true;
          return { ...it, pending: "failed" as const };
        }
        return it;
      });
      if (!changed) return state;
      return { ...state, items };
    }
    case "item-update": {
      const idx = state.itemsById[action.item.id];
      if (idx == null) {
        // Treat as append if we missed the original.
        const items = state.items.concat(action.item);
        return {
          ...state,
          items,
          itemsById: { ...state.itemsById, [action.item.id]: items.length - 1 },
        };
      }
      const items = state.items.slice();
      items[idx] = action.item;
      return { ...state, items };
    }
    case "turn-state": {
      // If the frame carries an error message, raise the sticky
      // banner. When the message changes (or no banner is currently
      // visible), reset `dismissed: false` so the banner re-shows
      // even after a prior dismissal of an older error. Same message
      // repeating preserves the existing `dismissed` flag (no
      // re-surfacing).
      let nextError = state.error;
      if (action.lastError) {
        if (!state.error || state.error.message !== action.lastError) {
          nextError = { message: action.lastError, dismissed: false };
        }
      }
      // Manage `activeTurnStartedAt` across turn-state transitions:
      //   • idle/error/interrupted → running : seed Date.now()
      //   • running → running              : preserve (multi-SDK-message
      //                                       within one turn)
      //   • running → anything-else        : clear to null
      //   • anything-else → anything-else  : leave null
      const nextStartedAt =
        action.state === "running"
          ? state.turnState !== "running"
            ? Date.now()
            : state.activeTurnStartedAt
          : null;
      // F2 failure path: a turn that ends in error/interruption can
      // never produce the server `item-append` that would reconcile an
      // optimistic bubble, so any still-"sending" placeholder is marked
      // "failed" here rather than stranded. Other transitions
      // (idle/running) leave pending items untouched — a cold-start send
      // legitimately stays "sending" through `running` until the echo
      // lands (F1 synergy). `items` is rebuilt in-place (same ids), so
      // `itemsById` is unaffected.
      let nextItems = state.items;
      if (action.state === "error" || action.state === "interrupted") {
        let changed = false;
        const mapped = state.items.map((it) => {
          if (it.kind === "user-message" && it.pending === "sending") {
            changed = true;
            return { ...it, pending: "failed" as const };
          }
          return it;
        });
        if (changed) nextItems = mapped;
      }
      return {
        ...state,
        items: nextItems,
        turnState: action.state,
        error: nextError,
        activeTurnStartedAt: nextStartedAt,
      };
    }
    case "pending-permission":
      return { ...state, pendingPermission: action.pending };
    case "pending-question":
      return { ...state, pendingQuestion: action.pending };
    case "permission-mode":
      return { ...state, permissionMode: action.mode };
    case "error-frame": {
      // Server-emitted `error` frame raises the sticky banner the
      // same way `turn-state` does — re-show with
      // `dismissed: false` when the message is new.
      if (state.error && state.error.message === action.message) return state;
      return { ...state, error: { message: action.message, dismissed: false } };
    }
    case "dismiss-error": {
      // Hide the banner; keep the message around so future-snapshot
      // novelty checks can compare against it. The banner re-shows
      // only when a different message arrives.
      if (!state.error || state.error.dismissed) return state;
      return { ...state, error: { ...state.error, dismissed: true } };
    }
    case "session-state": {
      // Server announced an `active ↔ recovering ↔ failed` transition.
      // Drives the `SessionRecoveryBanner`. When we transition BACK to
      // active (auto-respawn succeeded), clear the stale legacy
      // error-banner state so we don't stack notices — the recovery
      // banner itself goes away naturally as `lifecycle === "active"`.
      const nextError =
        action.lifecycle === "active" ? null : state.error;
      return {
        ...state,
        lifecycle: action.lifecycle,
        recoveryAttempt: action.recoveryAttempt ?? state.recoveryAttempt,
        error: nextError,
      };
    }
  }
}

export function LiveChatRoute({ chatId }: Props) {
  const [, navigate] = useLocation();
  const [chat, setChat] = useState<ApiChat | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [state, dispatch] = useReducer(chatReducer, EMPTY_STATE);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number | null>(null);
  // Bridge-supplied slash-command catalog. `null` until the first
  // `slash-commands-update` frame lands, at which point the composer
  // flips its menu out of the "Loading commands…" state.
  const bridge = useChatBridge();
  // Sidebar polls /api/sidebar/state every 5 s. When a chat-update frame
  // lands on the active chat's WS, kick the sidebar to refresh now so its
  // per-row indicators (notably the permission-mode dot) reflect the
  // change immediately instead of waiting up to a full poll interval.
  // Routed through a ref so the WS-attach effect's dep array stays
  // `[chatId]` and we don't reset the socket on provider re-renders.
  const sidebar = useSidebarState();
  const sidebarRefreshRef = useRef(sidebar.refresh);
  useEffect(() => {
    sidebarRefreshRef.current = sidebar.refresh;
  }, [sidebar.refresh]);
  /**
   * Right-pane state is a discriminated union: at most one of Tasks
   * / Diff is mounted at a time, with `null` collapsing the drawer.
   * The Diff arm is gated at the consumer site on
   * `chat?.worktree_mode === "worktree"` — the union itself stays
   * mode-agnostic so the toggle handler can stay pure (the topbar
   * conditionally renders the Diff button so the user never reaches
   * `rightPane === "diff"` in local mode).
   */
  const [rightPane, setRightPane] = useState<"tasks" | "diff" | "worktrees" | null>(null);
  // Resolved server default working-tree mode. Drives the pre-commit
  // copy of the {@link WorkspacePill} when `chat.worktree_mode === null`.
  const [defaultEnvMode, setDefaultEnvMode] = useState<"local" | "worktree">("local");
  // Server-resolved selectable models (config-overridable) for the
  // settings modal. `null` until the first `GET /settings` resolves;
  // the modal falls back to a built-in list in that window.
  const [models, setModels] = useState<ModelOption[] | null>(null);
  // Per-chat settings modal — opened from the gear anchored to the
  // top-right of the chat window (and from the `/model` slash-command).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Monotonic nonce bumped each time a turn's checkpoint lands
  // (`checkpoint-captured` WS frame). Passed to the diff panel as
  // `refreshSignal` so it re-fetches the total diff when the agent
  // finishes a turn, without the user clicking Refresh.
  const [diffRefreshNonce, setDiffRefreshNonce] = useState<number>(0);
  // Connection-status popover open state. The websocket pill in the
  // top-right of the top bar collapses to a coloured dot; clicking it
  // toggles a small info card with the state name and reconnect detail.
  const [connInfoOpen, setConnInfoOpen] = useState(false);
  const tasksAutoOpenedRef = useRef(false);

  // Question-nav (chat table-of-contents). Rendered as a full-height
  // column to the left of the message area + composer, so its divider
  // spans the whole content height. We derive the same timeline rows
  // the MessagesTimeline renders (cheap, memoized on items);
  // MessagesTimeline reports the in-view question id back up for the
  // active highlight.
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const navRows = useMemo(() => deriveTimelineRows(state.items), [state.items]);
  // Chat-wide user-image list + (messageId, localIdx) → global-index lookup,
  // shared by the chat bubbles and the QuestionNav so a click anywhere opens
  // the same carousel over every user image in the chat.
  const { images: chatImages, indexOf: imageIndexOf } = useMemo(
    () => collectUserImages(navRows, chatId),
    [navRows, chatId],
  );
  const lightbox = useLightbox();
  const openImage = useCallback(
    (messageId: string, localIdx: number) => {
      const idx = imageIndexOf(messageId, localIdx);
      if (idx >= 0) lightbox.open(idx);
    },
    [imageIndexOf, lightbox],
  );
  const jumpToMessage = useCallback((id: string) => {
    // `data-msg-id` is unique in the DOM, so a document-level query is
    // enough; scrollIntoView walks up to the timeline's scroll
    // container on its own.
    document
      .querySelector(`[data-msg-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  // Mirror `rightPane` into a ref so the `tasks-update` auto-open
  // guard (inside the ws-attach effect closure, which captures
  // `rightPane` once per `chatId`) can read the current value
  // without re-subscribing the WebSocket on every pane toggle.
  const rightPaneRef = useRef<"tasks" | "diff" | "worktrees" | null>(null);
  useEffect(() => {
    rightPaneRef.current = rightPane;
  }, [rightPane]);

  // Toggle handlers: flip to the discriminator when the other pane
  // (or null) is open; flip back to `null` when the same pane is
  // already open. Both use the functional setter so the click
  // handler is referentially stable and the toggle is race-free vs.
  // concurrent auto-open writes.
  const onToggleTasks = () =>
    setRightPane((p) => (p === "tasks" ? null : "tasks"));
  const onToggleDiff = () =>
    setRightPane((p) => (p === "diff" ? null : "diff"));
  const onToggleWorktrees = () =>
    setRightPane((p) => (p === "worktrees" ? null : "worktrees"));
  const snackbar = useSnackbar();

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedByUserRef = useRef(false);
  // F2 — monotonic counter for optimistic-bubble temp ids. A plain ref
  // (not `Date.now()`) so two sends in the same millisecond still get
  // distinct ids; never reset across chats (uniqueness is all that
  // matters, and the items themselves are cleared on `reset`).
  const optimisticSeqRef = useRef(0);
  // F2 — pending-bubble watchdog. Mirrors `state.items` so the timeout
  // callback (registered once) can decide whether any "sending"
  // placeholder is still outstanding without re-subscribing per render.
  const itemsRef = useRef<ChatItem[]>(state.items);
  useEffect(() => {
    itemsRef.current = state.items;
  }, [state.items]);
  // Diagnostic: if `attached` arrives but `snapshot` never does within
  // SNAPSHOT_TIMEOUT_MS, the bridge has accepted us but is wedged.
  // Without this the route silently renders an empty timeline.
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the chat row for the header.
  useEffect(() => {
    let alive = true;
    getChat(chatId)
      .then((r) => {
        if (!alive) return;
        setChat(r.chat);
        if (r.chat?.permission_mode) {
          dispatch({ type: "permission-mode", mode: r.chat.permission_mode });
        }
      })
      .catch((err) => { if (alive) setChatErr(errorText(err)); });
    return () => { alive = false; };
  }, [chatId]);

  // Reset the diff-refresh nonce when switching chats so the panel's
  // signal effect doesn't fire spuriously on the new chat's first render.
  useEffect(() => {
    setDiffRefreshNonce(0);
  }, [chatId]);

  // Fetch resolved server settings so the composer's mode-indicator can
  // show the right "(pending first-send)" label.
  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (!alive) return;
        if (s.workspace?.defaultEnvMode === "worktree") {
          setDefaultEnvMode("worktree");
        } else {
          setDefaultEnvMode("local");
        }
        setModels(s.models ?? null);
      })
      .catch(() => {
        // Settings fetch failures are non-fatal; the pill still renders
        // with the "local" default.
      });
    return () => { alive = false; };
  }, []);

  // (Re)connect the WebSocket on chatId change.
  useEffect(() => {
    closedByUserRef.current = false;
    let cancelled = false;

    dispatch({ type: "reset" });
    setTasks(null);
    setTasksUpdatedAt(null);
    setRightPane(null);
    tasksAutoOpenedRef.current = false;
    bridge.reset();

    const connect = () => {
      if (cancelled || closedByUserRef.current) return;
      setConn("connecting");
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConn("open");
        retryRef.current = 0;
        sendFrame(ws, { kind: "attach", "chat-id": chatId });
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        let frame: ServerFrame;
        const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
        try {
          frame = JSON.parse(raw);
        } catch (err) {
          // A malformed frame is a protocol bug, not a recoverable event.
          // Surface it so the user sees a banner and the console keeps the
          // payload for diagnosis — silent return masked this class of bug
          // before.
          console.error("[loom] failed to parse server frame", err, raw);
          dispatch({ type: "error-frame", message: "Received malformed frame from server" });
          return;
        }
        if (frame["chat-id"] && frame["chat-id"] !== chatId) return;
        switch (frame.kind) {
          case "attached":
            // Start the snapshot watchdog. Cleared on `snapshot`,
            // unmount, and any subsequent `attached` (reconnects).
            if (snapshotTimerRef.current !== null) clearTimeout(snapshotTimerRef.current);
            snapshotTimerRef.current = setTimeout(() => {
              snapshotTimerRef.current = null;
              dispatch({
                type: "error-frame",
                message:
                  "Chat attach succeeded but no snapshot arrived in 15s — bridge may be wedged. Try reloading.",
              });
            }, SNAPSHOT_TIMEOUT_MS);
            break;
          case "chat-update":
            // Patch in bridge-owned fields (notably `worktree_path`) that
            // weren't set when the initial `getChat` ran. The frame is
            // emitted right after the bridge's attach handler completes
            // its spawn-time resolution.
            if (frame.body?.chat) setChat(frame.body.chat);
            // Fire-and-forget so the sidebar's permission-mode dot (and
            // any other per-row fields) reflect this change immediately
            // instead of waiting for the next 5 s poll. The poll stays
            // as the safety net for non-WS-mediated changes.
            void sidebarRefreshRef.current();
            break;
          case "snapshot":
            if (snapshotTimerRef.current !== null) {
              clearTimeout(snapshotTimerRef.current);
              snapshotTimerRef.current = null;
            }
            dispatch({ type: "snapshot", payload: frame });
            break;
          case "item-append":
            dispatch({ type: "item-append", item: frame.body.item });
            break;
          case "item-update":
            dispatch({ type: "item-update", item: frame.body.item });
            break;
          case "turn-state":
            dispatch({ type: "turn-state", state: frame.body.state, lastError: frame.body.lastError });
            break;
          case "pending-permission":
            dispatch({ type: "pending-permission", pending: frame.body });
            break;
          case "pending-question":
            dispatch({ type: "pending-question", pending: frame.body });
            break;
          case "session-state":
            dispatch({
              type: "session-state",
              lifecycle: frame.body.lifecycle,
              recoveryAttempt: frame.body.recoveryAttempt,
              lastError: frame.body.lastError,
            });
            break;
          case "permission-mode-set":
            if (frame.body?.mode) {
              dispatch({ type: "permission-mode", mode: frame.body.mode });
            }
            break;
          case "slash-commands-update":
            bridge.handleServerFrame(frame);
            break;
          case "context-usage-update":
            bridge.handleServerFrame(frame);
            break;
          case "chat-meta-changed": {
            // Verb routes (switchRef / createRef / createWorktree / etc.) and
            // the attach-time git reconciler PATCH the row server-side then
            // broadcast this frame so the composer pills + diff panel
            // re-render without a refetch. Only merge the keys actually
            // present so a partial update never nulls a sibling field.
            const patch = frame.body ?? {};
            setChat((c) => {
              if (!c) return c;
              const next = { ...c };
              if ("branch" in patch) next.branch = patch.branch ?? null;
              if ("worktreePath" in patch) next.worktree_path = patch.worktreePath ?? null;
              if ("vcsKind" in patch) next.vcs_kind = patch.vcsKind ?? null;
              if ("repoName" in patch) next.repo_name = patch.repoName ?? null;
              return next;
            });
            break;
          }
          case "checkpoint-captured": {
            // Reactor wrote a new checkpoint ref for this chat — the agent
            // just finished a turn. Bump the nonce so the diff panel
            // re-fetches the total diff to reflect the new changes.
            setDiffRefreshNonce((n) => n + 1);
            break;
          }
          case "ref-change": {
            // Project-scoped HEAD watcher emitting an out-of-band branch
            // change. Local-mode chats whose cwd matches the watcher's
            // root update their attached-ref pill; worktree-mode chats
            // ignore the frame (their branch is owned by the worktree).
            setChat((c) => {
              if (!c) return c;
              if (c.worktree_mode === "worktree") return c;
              if (frame.body?.cwd !== c.cwd) return c;
              return { ...c, branch: frame.body.branch ?? c.branch };
            });
            break;
          }
          case "tasks-update": {
            const incoming = frame.body?.tasks ?? null;
            if (incoming) {
              setTasks(incoming);
              setTasksUpdatedAt(Date.now());
              // Auto-open only fires when the drawer is collapsed.
              // If the user has manually opened the Diff pane the
              // first `tasks-update` must not clobber that
              // selection — the ref still latches so subsequent
              // toggles are unaffected, but the precondition is
              // `rightPane === null`. The closure was captured at
              // attach time (the effect deps are `[chatId]`); the
              // ref stays current via the mirror effect above.
              if (
                !tasksAutoOpenedRef.current &&
                rightPaneRef.current === null &&
                incoming.length > 0
              ) {
                tasksAutoOpenedRef.current = true;
                setRightPane("tasks");
              }
            }
            break;
          }
          case "error":
            // Route the server's `error` frame through the reducer
            // so it raises the sticky banner instead of disappearing
            // into the console.
            console.warn("[loom] ws error frame:", frame.body?.message);
            if (frame.body?.message) {
              dispatch({ type: "error-frame", message: frame.body.message });
            }
            break;
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConn("closed");
        if (closedByUserRef.current) return;
        if (retryRef.current >= 10) return;
        retryRef.current++;
        setTimeout(connect, 1000);
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    };

    connect();
    return () => {
      cancelled = true;
      closedByUserRef.current = true;
      if (snapshotTimerRef.current !== null) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      try {
        const ws = wsRef.current;
        if (ws && ws.readyState === ws.OPEN) {
          sendFrame(ws, { kind: "detach", "chat-id": chatId });
        }
        ws?.close();
      } catch {}
    };
  }, [chatId]);

  const submitTurn = useCallback(
    (text: string, images: UserTurnImage[]) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      // Construct the wire body incrementally so optional fields are
      // absent (not undefined) when not in use — the server treats a
      // missing `images` field as the empty array.
      //
      // The body shape is the `user-turn` variant of the discriminated
      // `ClientFrame` union (chat-types.ts). We use `Extract<...>`
      // rather than a naked `T extends ... ? B : never` conditional —
      // when applied to a concrete union alias the conditional checks
      // the whole union against the predicate (no distribution over a
      // non-parameter), and since not every variant matches the
      // predicate the result resolves to `never`. `Extract` is the
      // idiom for "pick the matching variant" and yields the
      // addressable body type.
      type UserTurnBody = Extract<ClientFrame, { kind: "user-turn" }>["body"];
      const body: UserTurnBody = { text };
      if (images.length > 0) body.images = images;
      sendFrame(ws, { kind: "user-turn", "chat-id": chatId, body });

      // F2 — optimistic echo. We only reach this point AFTER the
      // `ws.OPEN` guard above passed, so a dropped send (early return)
      // never leaves a ghost bubble. The placeholder shows instantly,
      // bridging the dead air until the server echoes the turn as its
      // own `item-append` (warm: ~½ s; cold: up to ~10 s behind the F1
      // readiness gate). Map the local `UserTurnImage[]` →
      // `UserMessageImage[]`: `dataB64` is present on the freshly-typed
      // turn, so the thumbnails render from the inline data URL with no
      // `/chat-image` round-trip.
      const id = `${OPTIMISTIC_ID_PREFIX}${optimisticSeqRef.current++}`;
      const optimistic: UserMessageItem = {
        kind: "user-message",
        id,
        // The optimistic turn isn't tied to a server turn id yet; the
        // real echo (which carries the authoritative `turnId`) replaces
        // this item wholesale on reconcile, so a placeholder value is
        // fine here.
        turnId: id,
        text,
        createdAt: new Date().toISOString(),
        pending: "sending",
      };
      if (images.length > 0) {
        optimistic.images = images.map(
          (img): UserMessageImage => ({
            mediaType: img.mediaType,
            dataB64: img.dataB64,
            filename: img.filename,
          }),
        );
      }
      dispatch({ type: "optimistic-user", item: optimistic });

      // F3 — client-seed the "running" turn state so the WorkingChip
      // ("••• Working for Xs") appears INSTANTLY on send, with no
      // server round-trip. On a warm session the server's `turn-state
      // running` frame frequently never arrives for short turns
      // (measured: 0/2 warm sends produced one), leaving the user with
      // no "Claude is thinking" feedback between send and answer.
      // Reusing the existing `turn-state` reducer action seeds
      // `activeTurnStartedAt` via the same transition logic the server
      // frame uses; the `stop` hook's `turn-state idle` still clears it
      // at turn end (running→idle drops `activeTurnStartedAt` to null),
      // so a short warm turn shows the chip briefly then hides it.
      // Placed after the `ws.OPEN` guard so a dropped send seeds nothing.
      dispatch({ type: "turn-state", state: "running" });
    },
    [chatId],
  );

  // F2 — pending-bubble watchdog. Whenever at least one "sending"
  // placeholder is on screen, arm a single generous timer; if it fires
  // before the placeholder is reconciled (or already failed via a
  // turn-state error), flip any still-"sending" items to "failed" so
  // none strand forever. Re-arms on every items change — a fresh send
  // resets the clock, and a reconcile that clears the last pending item
  // tears the timer down (the guard short-circuits when nothing pends).
  const hasPending = state.items.some(
    (it) => it.kind === "user-message" && it.pending === "sending",
  );
  useEffect(() => {
    if (!hasPending) return;
    const t = setTimeout(() => {
      const stillPending = itemsRef.current.some(
        (it) => it.kind === "user-message" && it.pending === "sending",
      );
      if (stillPending) dispatch({ type: "fail-pending" });
    }, OPTIMISTIC_PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [hasPending, state.items]);

  const changePermissionMode = useCallback(
    (mode: PermissionMode) => {
      dispatch({ type: "permission-mode", mode });
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, {
        kind: "permission-mode-set",
        "chat-id": chatId,
        body: { mode },
      });
    },
    [chatId],
  );

  const setModelSettings = useCallback(
    (patch: Partial<WireModelSettings>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, {
        kind: "model-settings-set",
        "chat-id": chatId,
        body: patch,
      });
    },
    [chatId],
  );

  // Chat-row mutations surfaced in the settings modal (same set as the
  // sidebar right-click menu). These are plain REST calls; on success we
  // patch local state + kick the sidebar so its row reflects the change.
  const renameChatHandler = useCallback(
    async (name: string | null) => {
      try {
        const updated = await renameChat(chatId, name);
        setChat(updated);
        void sidebarRefreshRef.current();
      } catch (err) {
        console.warn("[loom] renameChat failed", err);
      }
    },
    [chatId],
  );

  const forkChatHandler = useCallback(async () => {
    try {
      const { chat: forked } = await forkChat(chatId);
      void sidebarRefreshRef.current();
      setSettingsOpen(false);
      navigate(`/chat/${forked.id}`);
    } catch (err) {
      console.warn("[loom] forkChat failed", err);
    }
  }, [chatId, navigate]);

  const handoffChatHandler = useCallback(async () => {
    try {
      await handoffChat(chatId);
    } catch (err) {
      console.warn("[loom] handoffChat failed", err);
    } finally {
      setSettingsOpen(false);
    }
  }, [chatId]);

  // Snackbar dismiss → flip the reducer's dismissed flag so the
  // same message doesn't re-raise on subsequent renders.
  const dismissError = useCallback(() => {
    dispatch({ type: "dismiss-error" });
  }, []);

  // Surface session errors as a global snackbar. Conditions:
  //   - lifecycle === "active" (SessionRecoveryBanner owns the
  //     recovering/failed states)
  //   - turnState === "error" (banner is suppressed once the bridge
  //     has moved past the error — recovery succeeded)
  //   - error is set and not user-dismissed
  // Keyed by chatId so navigating to another chat doesn't carry the
  // error forward; updating the same chat's snackbar replaces it in
  // place instead of stacking.
  const errorMessage = state.error && !state.error.dismissed ? state.error.message : null;
  const showError =
    state.lifecycle === "active" && state.turnState === "error" && errorMessage !== null;
  const errorSnackbarKey = `chat-error:${chatId}`;
  useEffect(() => {
    if (showError) {
      snackbar.show({
        key: errorSnackbarKey,
        type: "error",
        message: errorMessage!,
        onDismiss: dismissError,
      });
    } else {
      snackbar.dismissByKey(errorSnackbarKey);
    }
    return () => {
      snackbar.dismissByKey(errorSnackbarKey);
    };
  }, [showError, errorMessage, errorSnackbarKey, dismissError, snackbar]);

  // SessionRecoveryBanner's Retry button. Fires after the bridge has
  // exhausted its auto-respawn schedule (lifecycle === "failed").
  // No-op when the socket isn't open — the user can try again once
  // the WS reconnects (we also handle reconnect via the outer retry
  // loop).
  const retrySession = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    sendFrame(ws, { kind: "retry-session", "chat-id": chatId });
  }, [chatId]);

  const interruptTurn = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    sendFrame(ws, { kind: "interrupt", "chat-id": chatId });
  }, [chatId]);

  const respondToPermission = useCallback(
    (id: string, behavior: "allow" | "deny", remember?: boolean) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, {
        kind: "permission-response",
        "chat-id": chatId,
        body: { id, behavior, remember },
      });
    },
    [chatId],
  );

  /**
   * Accept the latest `plan-proposed` item — the server bridge
   * performs the `setPermissionMode("default")` + queued user-turn
   * pair atomically. The composer's current draft is NOT
   * auto-submitted and the mode change is NOT debounced.
   */
  const acceptPlanProposal = useCallback(
    (planId: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, {
        kind: "plan-accept",
        "chat-id": chatId,
        body: { planId },
      });
    },
    [chatId],
  );

  /**
   * Reject the latest `plan-proposed` item — the server bridge
   * queues a reconsider user-turn and leaves permission mode at
   * `"plan"`.
   */
  const rejectPlanProposal = useCallback(
    (planId: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, {
        kind: "plan-reject",
        "chat-id": chatId,
        body: { planId },
      });
    },
    [chatId],
  );

  /**
   * Forward the picker's submit payload as a typed
   * `question-response` ClientFrame. The bridge's
   * `respondToQuestion` resolves the SDK's pending tool call.
   */
  const respondToQuestion = useCallback(
    (id: string, answers: string[], otherText?: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      const body: { id: string; answers: string[]; otherText?: string } = {
        id,
        answers,
      };
      if (otherText !== undefined && otherText !== "") body.otherText = otherText;
      sendFrame(ws, {
        kind: "question-response",
        "chat-id": chatId,
        body,
      });
    },
    [chatId],
  );

  const pp = state.pendingPermission;
  // Three-state composer policy. `composerDisabled` is the
  // hard-disable derivative used by ChatComposer's textarea + send
  // button; `"blocked"` is the only mode that hard-disables. The
  // queue-mode keeps the composer enabled so the user can type and
  // submit a follow-up while a turn is still streaming.
  const mode: ComposerMode = composerMode({
    pendingPermission: state.pendingPermission,
    pendingQuestion: state.pendingQuestion,
    turnState: state.turnState,
    conn,
  });
  // Only `"blocked"` (a pending tool gate) hard-disables the composer.
  // `"offline"` deliberately stays OUT of the hard-disable so the user
  // can keep typing / keep a draft through a transient reconnect; the
  // send action is disabled inside ChatComposer instead, using the
  // connection `composerReason` below as the hint.
  const composerDisabled = mode === "blocked";
  // Send-disabled / disabled-placeholder reason. Permission/question
  // take precedence over the connection reason — same precedence as
  // `composerMode`'s branches — so an open tool gate explains itself
  // even if the socket also happens to be down. The connection reason
  // (F5) feeds the offline send-disabled hint when the composer is
  // editable-but-unsendable purely because the raw socket is not `open`.
  const composerReason = pp
    ? "Resolve the permission request to continue"
    : state.pendingQuestion
      ? "Answer the question to continue"
      : conn === "closed"
        ? "Connection lost — reconnecting…"
        : conn !== "open"
          ? "Connecting…"
          : undefined;
  // Top bar (right of logo). Tasks/Diff toggles live in the slim right
  // rail; the WebSocket status dot now lives at the bottom of that rail
  // too (see `rightRail` below). The Settings icon is anchored to the
  // far right inside a w-10 column whose width and left border mirror
  // the rail beneath it, so the cog sits directly above the rail icons.
  const topBar = (
    <>
      <div className="flex-1 min-w-0">
        {chatErr ? (
          <p className="text-[10px] truncate" style={{ color: "var(--destructive)" }}>{chatErr}</p>
        ) : null}
      </div>
      <Link
        href="/settings"
        className="w-10 h-full flex items-center justify-center shrink-0"
      >
        <button
          type="button"
          className="size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]"
          style={{ color: "var(--muted-foreground)" }}
          aria-label="Settings"
          title="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 01-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 014 17.93l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 010-4h.09A1.7 1.7 0 004.6 9.9a1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 016.07 4l.06.06a1.7 1.7 0 001.87.34h.09A1.7 1.7 0 009.1 2.91V3a2 2 0 014 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06A2 2 0 0119.93 7l-.06.06a1.7 1.7 0 00-.34 1.87v.09c.27.66.92 1.09 1.65 1.09H21a2 2 0 010 4h-.09c-.73 0-1.38.43-1.65 1.09z" />
          </svg>
        </button>
      </Link>
    </>
  );

  // Slim right rail — always visible vertical strip at the far right
  // edge that mirrors the left nav drawer's chrome. The two icon
  // buttons toggle which panel mounts in the (separate) right drawer
  // slot. The active icon highlights blue. The Diff icon only shows
  // for worktree-mode chats (`chat?.worktree_mode === "worktree"`).
  const rightRail = (
    <aside
      className="w-10 shrink-0 flex flex-col items-center border-l py-2 gap-1"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <button
        type="button"
        data-testid="tasks-toggle"
        onClick={onToggleTasks}
        className={clsx(
          "relative size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]",
          rightPane === "tasks"
            ? "bg-blue-500/10 text-blue-600"
            : "text-[var(--muted-foreground)]",
        )}
        title={rightPane === "tasks" ? "Hide tasks" : "Show tasks"}
        aria-pressed={rightPane === "tasks"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
        {tasks && tasks.length > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 text-[9px] font-mono leading-none px-1 rounded-full"
            style={{ background: "var(--primary)", color: "var(--primary-foreground, white)" }}
          >
            {tasks.length}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="diff-toggle"
        onClick={onToggleDiff}
        className={clsx(
          "size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]",
          rightPane === "diff"
            ? "bg-blue-500/10 text-blue-600"
            : "text-[var(--muted-foreground)]",
        )}
        title={rightPane === "diff" ? "Hide diff" : "Show diff"}
        aria-pressed={rightPane === "diff"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M6 8v8a2 2 0 002 2h6" />
          <path d="M18 16V8a2 2 0 00-2-2h-6" />
        </svg>
      </button>
      <button
        type="button"
        data-testid="worktrees-toggle"
        onClick={onToggleWorktrees}
        className={clsx(
          "size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]",
          rightPane === "worktrees"
            ? "bg-blue-500/10 text-blue-600"
            : "text-[var(--muted-foreground)]",
        )}
        title={rightPane === "worktrees" ? "Hide worktrees" : "Show worktrees"}
        aria-pressed={rightPane === "worktrees"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M8 6h6a2 2 0 012 2v2" />
          <path d="M8 18h6a2 2 0 002-2v-2" />
        </svg>
      </button>
      {/* WebSocket status dot — pinned to the bottom of the rail with
          `mt-auto`. Click reveals an info card that opens upward so it
          doesn't escape the viewport. */}
      <div className="relative mt-auto mb-1">
        <button
          type="button"
          data-testid="conn-status-dot"
          onClick={() => setConnInfoOpen((v) => !v)}
          className={clsx("size-2.5 rounded-full block", connDotBg(conn))}
          aria-label={`websocket ${conn}`}
          title={`websocket ${conn}`}
        />
        {connInfoOpen && (
          <div
            className="absolute right-0 bottom-full mb-1 z-40 rounded-md shadow-md text-[11px] px-3 py-2 min-w-[180px]"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="font-medium">WebSocket</span>
              <span className={clsx("text-[10px] font-mono px-1.5 py-0.5 rounded", connBg(conn))}>{conn}</span>
            </div>
            <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {conn === "open"
                ? "Live — messages stream in real time."
                : conn === "connecting"
                  ? "Re-attaching to the chat session…"
                  : conn === "closed"
                    ? "Connection lost. Retrying every second for ~10 s."
                    : "Not yet connected."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <AppLayout
      topBar={topBar}
      leftDrawer={<LiveSidebar />}
      rightDrawer={
        rightPane === "tasks" ? (
          <TasksPanel
            tasks={tasks}
            open={rightPane === "tasks"}
            onToggle={onToggleTasks}
            lastUpdatedAt={tasksUpdatedAt}
          />
        ) : rightPane === "diff" && chat ? (
          <DiffPanelContainer
            // Worktree chats diff their worktree; local ("current checkout")
            // chats have a null worktree_path, so fall back to the chat's cwd —
            // otherwise the panel never fetches a diff for local chats.
            worktreePath={chat.worktree_path ?? chat.cwd}
            chatId={chat.id}
            vcsKind={chat.vcs_kind ?? null}
            refreshSignal={diffRefreshNonce}
          />
        ) : rightPane === "worktrees" ? (
          <ProjectWorktreesPanel vcsKind={chat?.vcs_kind ?? null} />
        ) : undefined
      }
      rightRail={rightRail}
    >
      <div className="flex-1 flex flex-row min-h-0">
        <QuestionNav
          rows={navRows}
          chatId={chatId}
          activeId={activeQuestionId}
          onJump={jumpToMessage}
          onOpenImage={openImage}
        />
        <div className="flex-1 flex flex-col min-w-0">
        <MessagesTimeline
          key={chatId}
          items={state.items}
          turnState={state.turnState}
          chatId={chatId}
          activeTurnStartedAt={state.activeTurnStartedAt}
          onPlanAccept={acceptPlanProposal}
          onPlanReject={rejectPlanProposal}
          onActiveQuestionChange={setActiveQuestionId}
          onOpenImage={openImage}
        />
        {lightbox.isOpen && chatImages.length > 0 && (
          <ImageLightbox
            images={chatImages}
            activeIndex={lightbox.index}
            onChangeIndex={lightbox.open}
            onClose={lightbox.close}
            label="Chat image viewer"
          />
        )}

        {state.lifecycle !== "active" && (
          <SessionRecoveryBanner
            lifecycle={state.lifecycle}
            recoveryAttempt={state.recoveryAttempt}
            maxAttempts={3}
            lastError={state.error?.message ?? null}
            onRetry={retrySession}
          />
        )}

        {/* Raw transport (browser↔server WS) degradation. Self-gates:
            renders null when conn is open OR while a session recovery is
            in flight (SessionRecoveryBanner owns that — no stacking). */}
        <ConnectionBanner conn={conn} lifecycle={state.lifecycle} />

        {/* Transient chat errors now surface via the global Snackbar
            (see the `snackbar.show` effect above). SessionRecoveryBanner
            still owns the recovering/failed lifecycle banner since it
            has a structured Retry button that doesn't fit a toast. */}

        {pp && (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <PermissionRequestInline
              prompt={pp.title ?? `Allow ${pp.toolName}?`}
              args={stringifyArgs(pp.input)}
              reason={pp.description}
              onApproveOnce={() => respondToPermission(pp.id, "allow", false)}
              onAlwaysAllow={() => respondToPermission(pp.id, "allow", true)}
              onDecline={() => respondToPermission(pp.id, "deny", false)}
              onCancelTurn={() => respondToPermission(pp.id, "deny", false)}
            />
          </div>
        )}

        {state.pendingQuestion && (
          <div className="mx-auto w-full max-w-5xl px-4 pb-3">
            <AskUserQuestionPicker
              pending={state.pendingQuestion}
              onSubmit={({ answers, otherText }) =>
                respondToQuestion(state.pendingQuestion!.id, answers, otherText)
              }
            />
          </div>
        )}

        <ChatComposer
          composerMode={mode}
          disabled={composerDisabled}
          disabledReason={composerReason}
          onSubmit={submitTurn}
          isRunning={state.turnState === "running"}
          onInterrupt={interruptTurn}
          onPermissionModeChange={changePermissionMode}
          onOpenSettings={() => setSettingsOpen(true)}
          isInterrupted={state.turnState === "interrupted"}
          cwd={chat?.cwd}
          slashCommands={bridge.slashCommands}
          contextUsage={bridge.contextUsage}
          worktreeMode={chat?.worktree_mode ?? null}
          defaultEnvMode={defaultEnvMode}
          branch={chat?.branch ?? null}
          vcsKind={chat?.vcs_kind ?? null}
          repoName={chat?.repo_name ?? null}
        />

        <ChatSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          models={models}
          modelSettings={chat?.model_settings ?? null}
          onModelSettingsSet={setModelSettings}
          permissionMode={state.permissionMode}
          onPermissionModeChange={changePermissionMode}
          chatName={chat?.custom_name ?? null}
          autoTitle={chat?.auto_title ?? null}
          onRename={renameChatHandler}
          onFork={forkChatHandler}
          onHandoff={handoffChatHandler}
        />
        </div>
      </div>
    </AppLayout>
  );
}

function sendFrame(ws: WebSocket, frame: ClientFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {}
}

function stringifyArgs(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v;
    else {
      try { out[k] = JSON.stringify(v); } catch { out[k] = String(v); }
    }
  }
  return out;
}

function connBg(c: ConnState): string {
  switch (c) {
    case "open":
      return "bg-emerald-500/15 text-emerald-700";
    case "connecting":
      return "bg-amber-500/15 text-amber-700";
    case "closed":
      return "bg-red-500/15 text-red-700";
    default:
      return "bg-gray-500/15 text-gray-700";
  }
}

function connDotBg(c: ConnState): string {
  switch (c) {
    case "open":
      return "bg-emerald-500";
    case "connecting":
      return "bg-amber-500 animate-pulse";
    case "closed":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}
