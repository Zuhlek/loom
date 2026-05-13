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
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import clsx from "clsx";

import { AppLayout } from "../components/layout/AppLayout";
import { LiveSidebar } from "../components/LiveSidebar";
import { TasksPanel, type Task } from "../components/TasksPanel";
import { DiffPanelContainer } from "../components/diff/DiffPanelContainer";
import { MessagesTimeline } from "../components/chat/MessagesTimeline";
import { ChatComposer } from "../components/chat/ChatComposer";
import { PermissionRequestInline } from "../components/chat/PermissionRequestInline";
import { AskUserQuestionPicker } from "../components/chat/AskUserQuestionPicker";
import { useSnackbar } from "../components/ui/Snackbar";
import { SessionRecoveryBanner } from "../components/chat/SessionRecoveryBanner";
import { getChat, getSlashCommands, wsUrl, type ApiChat, type SlashCommandEntry } from "../lib/api";
import type {
  ChatItem,
  ClientFrame,
  PendingPermission,
  PendingQuestion,
  PermissionMode,
  ServerFrame,
  SessionLifecycle,
  TurnState,
  UserTurnImage,
} from "../lib/chat-types";
import type { ComposerQueuePriority } from "../components/chat/ChatComposer";

interface Props {
  chatId: string;
}

type ConnState = "idle" | "connecting" | "open" | "closed";

/**
 * T-007 / US-007 — Composer policy split per Design `## composerDisabled
 * policy split`. The legacy `composerDisabled = !!pendingPermission ||
 * !!pendingQuestion` boolean is replaced by a three-state selector so
 * the composer can distinguish "queued while running" from "hard-blocked
 * by a pending tool gate":
 *
 *   - `"ready"`   : composer enabled; submit goes through as
 *                   priority `"now"`. Includes `idle`, `interrupted`,
 *                   `error` — the `"interrupted"` case relies on the
 *                   SDK's implicit re-prime (US-005).
 *   - `"queue"`   : composer enabled but a turn is in flight. Send
 *                   button surfaces as "Queue"; submits push with
 *                   `priority: "next"` by default (the user can flip
 *                   the visible queue-priority toggle to "now" via the
 *                   T-004 composer control).
 *   - `"blocked"` : a pending permission or AskUserQuestion is open;
 *                   the composer hard-disables until the user
 *                   resolves the inline picker / permission card.
 *
 * Exported so the static-source contract tests can import it directly
 * and verify the selector behaviour; pure (depends only on the three
 * state fields).
 */
export type ComposerMode = "ready" | "queue" | "blocked";

export function composerMode(state: {
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
  turnState: TurnState;
}): ComposerMode {
  if (state.pendingPermission || state.pendingQuestion) return "blocked";
  if (state.turnState === "running") return "queue";
  return "ready";
}

interface ChatState {
  items: ChatItem[];
  itemsById: Record<string, number>;
  turnState: TurnState;
  /**
   * US-008. Sticky error banner state. Survives `snapshot` resets;
   * only overwritten when a NEW error arrives (different message),
   * and only hidden when the user explicitly dismisses. The banner
   * renders iff `error && !error.dismissed`.
   */
  error: { message: string; dismissed: boolean } | null;
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
  /** US-004. Current SDK permission mode driving the composer dropdown. */
  permissionMode: PermissionMode;
  /** US-004 / US-007. Current composer queue-priority selection. */
  queuePriority: ComposerQueuePriority;
  /**
   * T-003 / US-003 (chat-streaming-fixes). Millisecond epoch when the
   * active turn entered the `running` state. `null` whenever
   * `turnState` is not `"running"`. Consumed by `<WorkingChip>` (via
   * `<MessagesTimeline>`) to drive the "Working for Xs" elapsed
   * counter. Set on the idle→running transition; preserved across
   * multiple SDK messages within one turn (running→running); cleared
   * on any transition out of `"running"`. See ADR-005.
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

const EMPTY_STATE: ChatState = {
  items: [],
  itemsById: {},
  turnState: "idle",
  error: null,
  pendingPermission: null,
  pendingQuestion: null,
  permissionMode: "default",
  // T-007 AC2 / US-007. The toggle defaults to "next" so that the
  // first submit while a turn is running enqueues ahead by default
  // per the SDK scheduler (ADR-004). In `ready` mode the toggle is
  // not visible and the effective priority pinned to `"now"` at the
  // composer mount site, so this initial value does not leak onto
  // the wire for ready-mode submits.
  queuePriority: "next",
  // T-003 / US-003. Set by the reducer's `turn-state` branch on the
  // idle→running transition; never set elsewhere. Initial value
  // `null` because EMPTY_STATE represents the pre-attach state where
  // no turn is running.
  activeTurnStartedAt: null,
  lifecycle: "active",
  recoveryAttempt: 0,
};

type ChatAction =
  | { type: "reset" }
  | { type: "snapshot"; payload: ServerFrame & { kind: "snapshot" } }
  | { type: "item-append"; item: ChatItem }
  | { type: "item-update"; item: ChatItem }
  | { type: "turn-state"; state: TurnState; lastError?: string }
  | { type: "pending-permission"; pending: PendingPermission | null }
  | { type: "pending-question"; pending: PendingQuestion | null }
  | { type: "permission-mode"; mode: PermissionMode }
  | { type: "queue-priority"; priority: ComposerQueuePriority }
  | { type: "error-frame"; message: string }
  | { type: "dismiss-error" }
  | {
      type: "session-state";
      lifecycle: SessionLifecycle;
      recoveryAttempt?: number;
      lastError?: string;
    };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return EMPTY_STATE;
    case "snapshot": {
      const items = action.payload.body.items;
      const itemsById: Record<string, number> = {};
      items.forEach((it, i) => {
        itemsById[it.id] = i;
      });
      // US-008 AC2: the sticky error banner survives `snapshot` resets.
      // Only overwrite when the snapshot carries a NEW message (one
      // we haven't already surfaced); otherwise preserve `state.error`
      // verbatim (including the user's `dismissed` flag).
      const incoming = action.payload.body.lastError;
      const error =
        incoming && incoming !== state.error?.message
          ? { message: incoming, dismissed: false }
          : state.error;
      // T-003 / US-003 (ADR-005). On snapshot (initial attach or
      // reconnect-after-drain) the wire does not carry the original
      // turn-start timestamp (no-wire-shape constraint). If the
      // snapshot says we're already running, seed `activeTurnStartedAt`
      // to `Date.now()` — the chip restarts from 0s, which is the
      // best we can do. Otherwise clear it.
      const activeTurnStartedAt =
        action.payload.body.turnState === "running" ? Date.now() : null;
      return {
        items,
        itemsById,
        turnState: action.payload.body.turnState,
        error,
        pendingPermission: action.payload.body.pendingPermission ?? null,
        pendingQuestion: action.payload.body.pendingQuestion ?? null,
        // Preserve the locally-selected composer state across snapshots.
        // The server snapshot does not yet carry `permissionMode` — it
        // arrives on the chat row at attach time (a future T-NNN may
        // hydrate from the snapshot body).
        permissionMode: state.permissionMode,
        queuePriority: state.queuePriority,
        activeTurnStartedAt,
        lifecycle: action.payload.body.lifecycle ?? "active",
        recoveryAttempt: action.payload.body.recoveryAttempt ?? 0,
      };
    }
    case "item-append": {
      if (action.item.id in state.itemsById) return state;
      const items = state.items.concat(action.item);
      return {
        ...state,
        items,
        itemsById: { ...state.itemsById, [action.item.id]: items.length - 1 },
      };
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
      // US-008 AC1 / AC4. If the frame carries an error message,
      // raise the sticky banner. When the message changes (or no
      // banner is currently visible), reset `dismissed: false` so the
      // banner re-shows even if the user had previously dismissed an
      // older error. If the same message repeats, preserve the
      // existing `dismissed` flag (no re-surfacing).
      let nextError = state.error;
      if (action.lastError) {
        if (!state.error || state.error.message !== action.lastError) {
          nextError = { message: action.lastError, dismissed: false };
        }
      }
      // T-003 / US-003 (ADR-005). Manage `activeTurnStartedAt` across
      // turn-state transitions:
      //   • idle/error/interrupted → running : seed Date.now()
      //   • running → running              : preserve (multi-SDK-message
      //                                       within one turn — AC-4)
      //   • running → anything-else        : clear to null
      //   • anything-else → anything-else  : leave null
      const nextStartedAt =
        action.state === "running"
          ? state.turnState !== "running"
            ? Date.now()
            : state.activeTurnStartedAt
          : null;
      return {
        ...state,
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
    case "queue-priority":
      return { ...state, queuePriority: action.priority };
    case "error-frame": {
      // US-008 AC1 / AC4. Server-emitted `error` frame raises the
      // sticky banner the same way `turn-state` does — re-show with
      // `dismissed: false` when the message is new.
      if (state.error && state.error.message === action.message) return state;
      return { ...state, error: { message: action.message, dismissed: false } };
    }
    case "dismiss-error": {
      // US-008 AC3. Hide the banner; keep the message around so
      // future-snapshot novelty checks can compare against it. The
      // banner re-shows only when a different message arrives.
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
  const [chat, setChat] = useState<ApiChat | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [state, dispatch] = useReducer(chatReducer, EMPTY_STATE);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number | null>(null);
  /**
   * T-007 / US-004 + US-005. Right-pane state is a discriminated
   * union: at most one of Tasks / Diff is mounted at a time, with
   * `null` collapsing the drawer. The Diff arm is gated at the
   * consumer site on `chat?.worktree_mode === "worktree"` — the
   * union itself stays mode-agnostic so the toggle handler can
   * stay pure (the topbar conditionally renders the Diff button
   * so the user never reaches `rightPane === "diff"` in local
   * mode).
   */
  const [rightPane, setRightPane] = useState<"tasks" | "diff" | null>(null);
  const tasksAutoOpenedRef = useRef(false);
  // T-007. Mirror `rightPane` into a ref so the `tasks-update`
  // auto-open guard (inside the ws-attach effect closure, which
  // captures `rightPane` once per `chatId`) can read the current
  // value without re-subscribing the WebSocket on every pane
  // toggle.
  const rightPaneRef = useRef<"tasks" | "diff" | null>(null);
  useEffect(() => {
    rightPaneRef.current = rightPane;
  }, [rightPane]);

  // T-007. Toggle handlers per design.md contract: flip to the
  // discriminator when the other pane (or null) is open; flip back
  // to `null` when the same pane is already open. Both use the
  // functional setter so the click handler is referentially stable
  // and the toggle is race-free vs. concurrent auto-open writes.
  const onToggleTasks = () =>
    setRightPane((p) => (p === "tasks" ? null : "tasks"));
  const onToggleDiff = () =>
    setRightPane((p) => (p === "diff" ? null : "diff"));
  const [slashCommands, setSlashCommands] = useState<SlashCommandEntry[]>([]);
  const snackbar = useSnackbar();

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedByUserRef = useRef(false);

  // Fetch the chat row for the header.
  useEffect(() => {
    let alive = true;
    getChat(chatId)
      .then((r) => { if (alive) setChat(r.chat); })
      .catch((err) => { if (alive) setChatErr(err?.message ?? "load failed"); });
    return () => { alive = false; };
  }, [chatId]);

  // Fetch the slash-command catalog (user + project + plugin scope)
  // once the chat row resolves, so the composer's `/`-trigger menu can
  // surface project-scoped commands keyed off the chat's cwd. The
  // catalog is read-only and small; we don't re-fetch on tab focus.
  useEffect(() => {
    if (!chat?.cwd) return;
    let alive = true;
    getSlashCommands(chat.cwd)
      .then((r) => { if (alive) setSlashCommands(r.commands ?? []); })
      .catch(() => { /* non-fatal — the composer just hides its menu */ });
    return () => { alive = false; };
  }, [chat?.cwd]);

  // (Re)connect the WebSocket on chatId change.
  useEffect(() => {
    closedByUserRef.current = false;
    let cancelled = false;

    dispatch({ type: "reset" });
    setTasks(null);
    setTasksUpdatedAt(null);
    setRightPane(null);
    tasksAutoOpenedRef.current = false;

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
        try {
          frame = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
        } catch {
          return;
        }
        if (frame["chat-id"] && frame["chat-id"] !== chatId) return;
        switch (frame.kind) {
          case "attached":
            // No-op — snapshot follows.
            break;
          case "snapshot":
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
          case "tasks-update": {
            const incoming = frame.body?.tasks ?? null;
            if (incoming) {
              setTasks(incoming);
              setTasksUpdatedAt(Date.now());
              // T-007 / US-005 AC5. Auto-open only fires when the
              // drawer is collapsed. If the user has manually
              // opened the Diff pane we must not clobber their
              // selection when the first tasks-update arrives —
              // the ref still latches so we don't fight subsequent
              // toggles, but the new precondition is
              // `rightPane === null`. We read through
              // `rightPaneRef.current` because this closure was
              // captured at attach time (the effect deps are
              // `[chatId]`) — the ref stays current via the mirror
              // effect above.
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
            // US-008 AC1. Route the server's `error` frame through
            // the reducer so it raises the sticky banner instead of
            // disappearing into the console.
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
    (text: string, priority: ComposerQueuePriority, images: UserTurnImage[]) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      // Construct the wire body incrementally so optional fields are
      // absent (not undefined) when not in use — the server treats
      // missing fields as their defaults (priority → "now", images →
      // empty array) per ADR-004.
      const body: ClientFrame extends { kind: "user-turn"; body: infer B } ? B : never = { text };
      if (priority !== "now") body.priority = priority;
      if (images.length > 0) body.images = images;
      sendFrame(ws, { kind: "user-turn", "chat-id": chatId, body });
    },
    [chatId],
  );

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

  const changeQueuePriority = useCallback((priority: ComposerQueuePriority) => {
    dispatch({ type: "queue-priority", priority });
  }, []);

  // US-008 AC3. Snackbar dismiss → flip the reducer's dismissed flag so
  // the same message doesn't re-raise on subsequent renders.
  const dismissError = useCallback(() => {
    dispatch({ type: "dismiss-error" });
  }, []);

  // Surface session errors as a global snackbar instead of a stacked
  // banner. Conditions mirror the legacy ChatErrorBanner gate:
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
   * T-003 / US-003 AC3. Accept the latest `plan-proposed` item — the
   * server bridge performs the `setPermissionMode("default")` + queued
   * user-turn pair atomically. Per ADR-004 we do NOT auto-submit the
   * composer's current draft and we do NOT debounce the mode change.
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
   * T-003 / US-003 AC4. Reject the latest `plan-proposed` item — the
   * server bridge queues a reconsider user-turn and leaves permission
   * mode at `"plan"`.
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
   * US-001 AC5. Forward the picker's submit payload as a typed
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
  // T-007. Three-state composer policy. `composerDisabled` is the
  // hard-disable derivative used by ChatComposer's textarea + send
  // button; `"blocked"` is the only mode that hard-disables. The
  // queue-mode keeps the composer enabled so the user can type and
  // submit a follow-up while a turn is still streaming.
  const mode: ComposerMode = composerMode({
    pendingPermission: state.pendingPermission,
    pendingQuestion: state.pendingQuestion,
    turnState: state.turnState,
  });
  const composerDisabled = mode === "blocked";
  const composerReason = pp
    ? "Resolve the permission request to continue"
    : state.pendingQuestion
      ? "Answer the question to continue"
      : undefined;
  // T-007 AC2. Mode-driven default queue-priority. While a turn is
  // running (`mode === "queue"`) the submit pushes `priority: "next"`
  // by default so the follow-up slots ahead of the streaming turn's
  // continuation per the SDK's scheduler (ADR-004). Otherwise the
  // submit pushes `priority: "now"`. The user's explicit toggle (T-004's
  // visible queue-priority `<select>`, only rendered in queue mode)
  // sits on top of this default — `state.queuePriority` is the
  // override, applied only when the toggle is visible. In non-queue
  // modes we hard-pin to `"now"` to keep the wire byte-compatible
  // with legacy emitters.
  const queueModeDefault: ComposerQueuePriority =
    mode === "queue" ? "next" : "now";
  const effectiveQueuePriority: ComposerQueuePriority =
    mode === "queue" ? state.queuePriority : queueModeDefault;

  const topBar = (
    <>
      <div className="flex-1 min-w-0">
        {chatErr ? (
          <p className="text-[10px] truncate" style={{ color: "var(--destructive)" }}>{chatErr}</p>
        ) : null}
      </div>
      <button
        type="button"
        data-testid="tasks-toggle"
        onClick={onToggleTasks}
        className={clsx(
          "text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-black/5 border",
          rightPane === "tasks" && "bg-black/5",
        )}
        style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
        title={rightPane === "tasks" ? "Hide tasks" : "Show tasks"}
      >
        Tasks{tasks && tasks.length > 0 ? ` (${tasks.length})` : ""}
      </button>
      {chat?.worktree_mode === "worktree" && (
        <button
          type="button"
          data-testid="diff-toggle"
          onClick={onToggleDiff}
          className={clsx(
            "text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-black/5 border",
            rightPane === "diff" && "bg-black/5",
          )}
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
          title={rightPane === "diff" ? "Hide diff" : "Show diff"}
        >
          Diff
        </button>
      )}
      <span
        className={clsx("text-[10px] font-mono px-1.5 py-0.5 rounded", connBg(conn))}
        title={`websocket ${conn}`}
      >
        {conn}
      </span>
    </>
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
        ) : rightPane === "diff" && chat?.worktree_mode === "worktree" ? (
          <DiffPanelContainer
            worktreePath={chat.worktree_path}
            chatId={chat.id}
          />
        ) : undefined
      }
    >
        <MessagesTimeline
          items={state.items}
          turnState={state.turnState}
          activeTurnStartedAt={state.activeTurnStartedAt}
          onPlanAccept={acceptPlanProposal}
          onPlanReject={rejectPlanProposal}
        />

        {state.lifecycle !== "active" && (
          <SessionRecoveryBanner
            lifecycle={state.lifecycle}
            recoveryAttempt={state.recoveryAttempt}
            maxAttempts={3}
            lastError={state.error?.message ?? null}
            onRetry={retrySession}
          />
        )}

        {/* Transient chat errors now surface via the global Snackbar
            (see the `snackbar.show` effect above). SessionRecoveryBanner
            still owns the recovering/failed lifecycle banner since it
            has a structured Retry button that doesn't fit a toast. */}

        {pp && (
          <div className="px-5 pb-3">
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
          <div className="px-5 pb-3">
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
          permissionMode={state.permissionMode}
          onPermissionModeChange={changePermissionMode}
          queuePriority={effectiveQueuePriority}
          onQueuePriorityChange={changeQueuePriority}
          isInterrupted={state.turnState === "interrupted"}
          availableSlashCommands={slashCommands}
        />
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
