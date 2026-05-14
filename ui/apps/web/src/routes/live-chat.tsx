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
import { Link } from "wouter";
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
import { getChat, wsUrl, type ApiChat } from "../lib/api";
import { useChatBridge } from "../lib/use-chat-bridge";
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
  WireModelSettings,
} from "../lib/chat-types";

interface Props {
  chatId: string;
}

type ConnState = "idle" | "connecting" | "open" | "closed";

/**
 * Composer policy selector. Returns a three-state value the composer
 * uses to distinguish "queued while running" from "hard-blocked by a
 * pending tool gate":
 *
 *   - `"ready"`   : composer enabled; submit goes through as
 *                   priority `"now"`. Includes `idle`, `interrupted`,
 *                   `error` — the `"interrupted"` case relies on the
 *                   SDK's implicit re-prime.
 *   - `"queue"`   : composer enabled but a turn is in flight. Send
 *                   button surfaces as "Queue"; submits land in the
 *                   SDK's user-message queue and the server treats
 *                   missing-priority as the default "now" placement.
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

const EMPTY_STATE: ChatState = {
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
      // Sticky error banner survives `snapshot` resets. Overwrite
      // only when the snapshot carries a NEW message (not the one
      // already surfaced); otherwise preserve `state.error` verbatim
      // (including the `dismissed` flag).
      const incoming = action.payload.body.lastError;
      const error =
        incoming && incoming !== state.error?.message
          ? { message: incoming, dismissed: false }
          : state.error;
      // On snapshot (initial attach or reconnect-after-drain) the
      // wire does not carry the original turn-start timestamp. If
      // the snapshot reports `running`, seed `activeTurnStartedAt`
      // to `Date.now()` — the chip restarts from 0s. Otherwise
      // clear it.
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
        // arrives on the chat row at attach time.
        permissionMode: state.permissionMode,
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
  /**
   * Right-pane state is a discriminated union: at most one of Tasks
   * / Diff is mounted at a time, with `null` collapsing the drawer.
   * The Diff arm is gated at the consumer site on
   * `chat?.worktree_mode === "worktree"` — the union itself stays
   * mode-agnostic so the toggle handler can stay pure (the topbar
   * conditionally renders the Diff button so the user never reaches
   * `rightPane === "diff"` in local mode).
   */
  const [rightPane, setRightPane] = useState<"tasks" | "diff" | null>(null);
  // Connection-status popover open state. The websocket pill in the
  // top-right of the top bar collapses to a coloured dot; clicking it
  // toggles a small info card with the state name and reconnect detail.
  const [connInfoOpen, setConnInfoOpen] = useState(false);
  const tasksAutoOpenedRef = useRef(false);
  // Mirror `rightPane` into a ref so the `tasks-update` auto-open
  // guard (inside the ws-attach effect closure, which captures
  // `rightPane` once per `chatId`) can read the current value
  // without re-subscribing the WebSocket on every pane toggle.
  const rightPaneRef = useRef<"tasks" | "diff" | null>(null);
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
          case "chat-update":
            // Patch in bridge-owned fields (notably `worktree_path`) that
            // weren't set when the initial `getChat` ran. The frame is
            // emitted right after the bridge's attach handler completes
            // its spawn-time resolution.
            if (frame.body?.chat) setChat(frame.body.chat);
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
          case "slash-commands-update":
            bridge.handleServerFrame(frame);
            break;
          case "context-usage-update":
            bridge.handleServerFrame(frame);
            break;
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
      // absent (not undefined) when not in use — the server treats
      // missing fields as their defaults (priority → "now", images →
      // empty array). The composer no longer exposes a priority
      // toggle, so every submit relies on the default "now"
      // placement.
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
  });
  const composerDisabled = mode === "blocked";
  const composerReason = pp
    ? "Resolve the permission request to continue"
    : state.pendingQuestion
      ? "Answer the question to continue"
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
      {chat?.worktree_mode === "worktree" && (
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
      )}
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
        ) : rightPane === "diff" && chat?.worktree_mode === "worktree" ? (
          <DiffPanelContainer
            worktreePath={chat.worktree_path}
            chatId={chat.id}
          />
        ) : undefined
      }
      rightRail={rightRail}
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
          isInterrupted={state.turnState === "interrupted"}
          cwd={chat?.cwd}
          slashCommands={bridge.slashCommands}
          contextUsage={bridge.contextUsage}
          modelSettings={chat?.model_settings ?? null}
          onModelSettingsSet={setModelSettings}
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
