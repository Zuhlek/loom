/**
 * LiveChatRoute — opens a WebSocket to /ws, sends an `attach` frame for
 * the chat-id, and pipes pty-out bytes into an xterm.js Terminal so
 * Claude's TUI renders faithfully (colors, cursor, alt screen, etc.).
 *
 * Keystrokes typed into the terminal are forwarded back as `pty-in`
 * frames; the FitAddon + a ResizeObserver keep PTY dimensions matched
 * to the visible container via `resize` frames.
 *
 * Reconnect logic: if the socket closes while the route is mounted we
 * retry every 1 s up to ~10 s.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { LiveSidebar } from "../components/LiveSidebar";
import { TasksPanel, type Task } from "../components/TasksPanel";
import { getChat, wsUrl, type ApiChat } from "../lib/api";
import clsx from "clsx";

interface Props {
  chatId: string;
}

type ConnState = "idle" | "connecting" | "open" | "closed";

export function LiveChatRoute({ chatId }: Props) {
  const [chat, setChat] = useState<ApiChat | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState<number | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  // Auto-open the panel the first time we ever see a TodoWrite update;
  // after that respect the user's choice.
  const tasksAutoOpenedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const termContainerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSentDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const retryRef = useRef(0);
  const closedByUserRef = useRef(false);

  // Fetch the chat row.
  useEffect(() => {
    let alive = true;
    getChat(chatId)
      .then((r) => {
        if (alive) setChat(r.chat);
      })
      .catch((err) => {
        if (alive) setChatErr(err?.message ?? "load failed");
      });
    return () => {
      alive = false;
    };
  }, [chatId]);

  // Mount the xterm once on mount.
  useEffect(() => {
    if (!termContainerRef.current) return;
    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#fafafa",
        foreground: "#111111",
        cursor: "#111111",
        cursorAccent: "#fafafa",
        selectionBackground: "rgba(59,130,246,0.25)",
        black: "#1a1a1a",
        red: "#c62828",
        green: "#2e7d32",
        yellow: "#9a6b00",
        blue: "#1565c0",
        magenta: "#7b1fa2",
        cyan: "#00838f",
        white: "#dcdcdc",
        brightBlack: "#5c5c5c",
        brightRed: "#ef5350",
        brightGreen: "#43a047",
        brightYellow: "#c98a00",
        brightBlue: "#1e88e5",
        brightMagenta: "#9c27b0",
        brightCyan: "#00acc1",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(termContainerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // Forward keystrokes to the WS as pty-in frames.
    const offData = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            kind: "pty-in",
            "chat-id": chatId,
            body: { data },
          }),
        );
      }
    });

    // Initial fit + resize-observer to keep PTY dims in sync with viewport.
    const sendResizeIfChanged = () => {
      try {
        fit.fit();
      } catch {}
      const cols = term.cols;
      const rows = term.rows;
      const last = lastSentDimsRef.current;
      if (!last || last.cols !== cols || last.rows !== rows) {
        lastSentDimsRef.current = { cols, rows };
        const ws = wsRef.current;
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              kind: "resize",
              "chat-id": chatId,
              body: { cols, rows },
            }),
          );
        }
      }
    };

    // Defer initial fit to next frame so the container has its final size.
    const initialTimer = window.setTimeout(sendResizeIfChanged, 0);

    const ro = new ResizeObserver(() => sendResizeIfChanged());
    ro.observe(termContainerRef.current);

    return () => {
      window.clearTimeout(initialTimer);
      ro.disconnect();
      offData.dispose();
      try {
        term.dispose();
      } catch {}
      termRef.current = null;
      fitRef.current = null;
      lastSentDimsRef.current = null;
    };
  }, [chatId]);

  // Open WS once we have a chat id; refresh on chatId change.
  useEffect(() => {
    closedByUserRef.current = false;
    let cancelled = false;
    // Reset terminal and tasks on chat switch.
    if (termRef.current) termRef.current.reset();
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
        ws.send(
          JSON.stringify({
            kind: "attach",
            "chat-id": chatId,
          }),
        );
        // Send the current dims so the PTY starts with the right window.
        const term = termRef.current;
        if (term && term.cols > 0 && term.rows > 0) {
          ws.send(
            JSON.stringify({
              kind: "resize",
              "chat-id": chatId,
              body: { cols: term.cols, rows: term.rows },
            }),
          );
          lastSentDimsRef.current = { cols: term.cols, rows: term.rows };
        }
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        let env: any;
        try {
          env = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data));
        } catch {
          return;
        }
        const term = termRef.current;
        if (env.kind === "tasks-update" && env["chat-id"] === chatId) {
          const incoming = Array.isArray(env.body?.tasks) ? (env.body.tasks as Task[]) : null;
          if (incoming) {
            setTasks(incoming);
            setTasksUpdatedAt(Date.now());
            if (!tasksAutoOpenedRef.current && incoming.length > 0) {
              tasksAutoOpenedRef.current = true;
              setTasksOpen(true);
            }
          }
          return;
        }
        if (!term) return;
        if (env.kind === "pty-out" && env["chat-id"] === chatId) {
          const data = env.body?.data;
          if (typeof data === "string") {
            if (env.body?.replay) {
              term.reset();
            }
            term.write(data);
          }
        } else if (env.kind === "pty-exit" && env["chat-id"] === chatId) {
          term.write(`\r\n[loom] PTY exited (code=${env.body?.exitCode}).\r\n`);
        } else if (env.kind === "error") {
          term.write(`\r\n[loom] error: ${env.body?.message ?? "unknown"}\r\n`);
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
        try {
          ws.close();
        } catch {}
      };
    };

    connect();

    return () => {
      cancelled = true;
      closedByUserRef.current = true;
      try {
        const ws = wsRef.current;
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ kind: "detach", "chat-id": chatId }));
        }
        ws?.close();
      } catch {}
    };
  }, [chatId]);

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
            <p className="text-sm font-medium truncate">
              {chat ? chat.cwd : chatId}
            </p>
            {chatErr ? (
              <p className="text-[10px]" style={{ color: "var(--destructive)" }}>
                {chatErr}
              </p>
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

        <div
          ref={termContainerRef}
          className="flex-1 overflow-hidden px-2 py-2"
          style={{ background: "#fafafa" }}
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
