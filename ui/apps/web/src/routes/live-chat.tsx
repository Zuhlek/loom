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

import { LiveSidebar } from "../components/LiveSidebar";
import { TasksPanel, type Task } from "../components/TasksPanel";
import { MessagesTimeline } from "../components/chat/MessagesTimeline";
import { ChatComposer } from "../components/chat/ChatComposer";
import { PermissionRequestInline } from "../components/chat/PermissionRequestInline";
import { getChat, wsUrl, type ApiChat } from "../lib/api";
import type {
  ChatItem,
  ClientFrame,
  PendingPermission,
  PendingQuestion,
  ServerFrame,
  TurnState,
} from "../lib/chat-types";

interface Props {
  chatId: string;
}

type ConnState = "idle" | "connecting" | "open" | "closed";

interface ChatState {
  items: ChatItem[];
  itemsById: Record<string, number>;
  turnState: TurnState;
  lastError: string | undefined;
  pendingPermission: PendingPermission | null;
  pendingQuestion: PendingQuestion | null;
}

const EMPTY_STATE: ChatState = {
  items: [],
  itemsById: {},
  turnState: "idle",
  lastError: undefined,
  pendingPermission: null,
  pendingQuestion: null,
};

type ChatAction =
  | { type: "reset" }
  | { type: "snapshot"; payload: ServerFrame & { kind: "snapshot" } }
  | { type: "item-append"; item: ChatItem }
  | { type: "item-update"; item: ChatItem }
  | { type: "turn-state"; state: TurnState; lastError?: string }
  | { type: "pending-permission"; pending: PendingPermission | null }
  | { type: "pending-question"; pending: PendingQuestion | null };

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
      return {
        items,
        itemsById,
        turnState: action.payload.body.turnState,
        lastError: action.payload.body.lastError,
        pendingPermission: action.payload.body.pendingPermission ?? null,
        pendingQuestion: action.payload.body.pendingQuestion ?? null,
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
    case "turn-state":
      return { ...state, turnState: action.state, lastError: action.lastError };
    case "pending-permission":
      return { ...state, pendingPermission: action.pending };
    case "pending-question":
      return { ...state, pendingQuestion: action.pending };
  }
}

export function LiveChatRoute({ chatId }: Props) {
  const [chat, setChat] = useState<ApiChat | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [state, dispatch] = useReducer(chatReducer, EMPTY_STATE);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksAutoOpenedRef = useRef(false);

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
    setTasksOpen(false);
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
          case "tasks-update": {
            const incoming = frame.body?.tasks ?? null;
            if (incoming) {
              setTasks(incoming);
              setTasksUpdatedAt(Date.now());
              if (!tasksAutoOpenedRef.current && incoming.length > 0) {
                tasksAutoOpenedRef.current = true;
                setTasksOpen(true);
              }
            }
            break;
          }
          case "error":
            console.warn("[loom] ws error frame:", frame.body?.message);
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
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      sendFrame(ws, { kind: "user-turn", "chat-id": chatId, body: { text } });
    },
    [chatId],
  );

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

  const pp = state.pendingPermission;
  const composerDisabled = !!pp || !!state.pendingQuestion;
  const composerReason = pp
    ? "Resolve the permission request to continue"
    : state.pendingQuestion
      ? "Answer the question to continue"
      : undefined;

  return (
    <div className="h-screen flex">
      <LiveSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b px-4 py-2.5 flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <Link href="/">
            <button className="text-xs hover:underline" style={{ color: "var(--muted-foreground)" }}>
              ← Home
            </button>
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{chat ? chat.cwd : chatId}</p>
            {chatErr ? (
              <p className="text-[10px]" style={{ color: "var(--destructive)" }}>{chatErr}</p>
            ) : (
              <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                {chat ? `${chat.permission_mode} · ${chat.worktree_mode}` : "loading..."}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="tasks-toggle"
            onClick={() => setTasksOpen((v) => !v)}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-black/5 border"
            style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            title={tasksOpen ? "Hide tasks" : "Show tasks"}
          >
            Tasks{tasks && tasks.length > 0 ? ` (${tasks.length})` : ""}
          </button>
          <span
            className={clsx("text-[10px] font-mono px-1.5 py-0.5 rounded", connBg(conn))}
            title={`websocket ${conn}`}
          >
            {conn}
          </span>
        </header>

        <MessagesTimeline items={state.items} turnState={state.turnState} />

        {state.lastError && state.turnState === "error" && (
          <div className="mx-5 mb-2 px-3 py-2 rounded-md text-[12px]" style={{ background: "rgba(239,68,68,0.08)", color: "var(--destructive-foreground)" }}>
            {state.lastError}
          </div>
        )}

        {pp && (
          <div className="px-5 pb-3">
            <PermissionRequestInline
              tool={pp.toolName}
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

        <ChatComposer
          disabled={composerDisabled}
          disabledReason={composerReason}
          onSubmit={submitTurn}
          isRunning={state.turnState === "running"}
          onInterrupt={interruptTurn}
        />
      </main>
      <TasksPanel
        tasks={tasks}
        open={tasksOpen}
        onToggle={() => setTasksOpen((v) => !v)}
        lastUpdatedAt={tasksUpdatedAt}
      />
    </div>
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
