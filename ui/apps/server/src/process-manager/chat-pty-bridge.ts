/**
 * Chat-PTY bridge — manages claude PTY processes keyed by chat-id.
 *
 * One claude PTY per chat. Multiple WS clients can attach to the same
 * chat-id; the bridge fans bytes out. When the last client disconnects we
 * start a 30 s drain timer; if no one reattaches we SIGTERM the process.
 *
 * On reattach after a graceful shutdown we lazy-spawn `claude --resume
 * <session-id>` if the chat row carries a session-id.
 *
 * Note (post-mvp): we currently use `child_process.spawn` (see pty.ts).
 * vt100 escape passthrough and resize-on-SIGWINCH are not faithful. The
 * chat surface uses a plain <pre> element; this is good enough for v1.
 */
import { spawnPty, type PtyProcess } from "./pty.ts";
import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatRow } from "../metadata-store/repos/chat.ts";
import { TranscriptWatcher, type Task } from "../transcript-watcher.ts";
export type { Task } from "../transcript-watcher.ts";

export interface ChatSession {
  chatId: string;
  pty: PtyProcess;
  buffer: string;
  clients: Set<WsClient>;
  drainTimer: NodeJS.Timeout | null;
  exited: boolean;
  exitCode: number | null;
  watcher: TranscriptWatcher | null;
  latestTasks: Task[] | null;
}

export interface WsClient {
  send(text: string): void;
  close?(): void;
}

export interface BridgeOptions {
  /** Override the executable. Defaults to "claude". Tests can pass "echo". */
  claudeBin?: string;
  /** Drain delay in ms before SIGTERM after the last client leaves. */
  drainMs?: number;
  /** Whether to spawn via the node-pty helper. Defaults true; tests pass false. */
  useHelper?: boolean;
  /** Disable the TodoWrite transcript watcher (tests). */
  disableTranscriptWatcher?: boolean;
  /** Override the claude home dir used to locate transcripts (tests). */
  claudeHome?: string;
}

const DEFAULT_DRAIN_MS = 30_000;

/** Listener for tasks-update events, fanned out to all WS clients. */
export type TasksUpdateListener = (chatId: string, tasks: Task[]) => void;

export class ChatPtyBridge {
  private sessions = new Map<string, ChatSession>();
  private claudeBin: string;
  private drainMs: number;
  private useHelper: boolean;
  private disableTranscriptWatcher: boolean;
  private claudeHome: string | undefined;
  private tasksListeners = new Set<TasksUpdateListener>();

  constructor(private store: MetadataStore, opts: BridgeOptions = {}) {
    this.claudeBin = opts.claudeBin ?? "claude";
    this.drainMs = opts.drainMs ?? DEFAULT_DRAIN_MS;
    this.useHelper = opts.useHelper ?? true;
    this.disableTranscriptWatcher = opts.disableTranscriptWatcher ?? false;
    this.claudeHome = opts.claudeHome;
  }

  /** Subscribe to tasks-update events. Returns an unsubscribe fn. */
  onTasksUpdate(cb: TasksUpdateListener): () => void {
    this.tasksListeners.add(cb);
    return () => this.tasksListeners.delete(cb);
  }

  /** Latest known task list for a chat, or null if we haven't seen one yet. */
  getLatestTasks(chatId: string): Task[] | null {
    return this.sessions.get(chatId)?.latestTasks ?? null;
  }

  /** Get or spawn the claude PTY for this chat. Throws if the chat row is absent. */
  attach(chatId: string, client: WsClient): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      const chat = this.store.chats.get(chatId);
      if (!chat) {
        throw new Error(`chat not found: ${chatId}`);
      }
      session = this.spawn(chat);
      this.sessions.set(chatId, session);
    }

    if (session.drainTimer) {
      clearTimeout(session.drainTimer);
      session.drainTimer = null;
    }

    session.clients.add(client);

    // Always send a replay-flagged frame so the client xterm resets,
    // even when the buffer is empty (e.g. right after a respawn). Without
    // this, a fresh claude's banner would be appended to the previous
    // run's output already on screen.
    try {
      client.send(
        JSON.stringify({
          kind: "pty-out",
          "chat-id": chatId,
          body: { data: session.buffer, replay: true },
        }),
      );
    } catch {}

    // Replay the latest known TASKS so a re-attaching client sees the
    // panel populated immediately, not after the next TodoWrite call.
    if (session.latestTasks) {
      try {
        client.send(
          JSON.stringify({
            kind: "tasks-update",
            "chat-id": chatId,
            body: { tasks: session.latestTasks, replay: true },
          }),
        );
      } catch {}
    }

    return session;
  }

  detach(chatId: string, client: WsClient): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.clients.delete(client);
    if (session.clients.size === 0 && !session.exited) {
      // Drain timer — give the user a window to refresh / re-open the tab.
      session.drainTimer = setTimeout(() => {
        try {
          session.pty.kill("SIGTERM");
        } catch {}
        // Mark inert in the store; the next attach will respawn.
        this.store.chats.markInert(chatId);
      }, this.drainMs);
    }
  }

  /** Forward keystrokes from a WS client into the PTY. */
  write(chatId: string, data: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.pty.write(data);
  }

  /** Forward a resize event from a WS client into the PTY. */
  resize(chatId: string, cols: number, rows: number): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    try {
      session.pty.resize(cols, rows);
    } catch {}
  }

  /** Drop a session entirely (used on chat delete or process exit). */
  dispose(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    if (session.drainTimer) clearTimeout(session.drainTimer);
    try {
      session.pty.kill("SIGTERM");
    } catch {}
    try {
      session.watcher?.stop();
    } catch {}
    this.sessions.delete(chatId);
  }

  private spawn(chat: ChatRow): ChatSession {
    const args: string[] = [];
    if (chat.session_id) {
      // First spawn for this chat uses --session-id so claude writes its
      // transcript under the UUID we pre-generated; we tail that JSONL
      // for the TASKS side-panel. Subsequent spawns (after the user has
      // left the tab and the drain timer SIGTERM'd the process) use
      // --resume to pick up where claude left off.
      const flag = chat.inert ? "--resume" : "--session-id";
      args.push(flag, chat.session_id);
    }
    // Pass permission mode through. Claude code accepts `--permission-mode`.
    if (chat.permission_mode && chat.permission_mode !== "default") {
      args.push("--permission-mode", chat.permission_mode);
    }
    // TODO(post-mvp): worktree mode — chat.worktree_mode === "worktree" should
    // run claude inside a fresh git worktree spun up by the worktree-manager
    // module. For v1 we always spawn in chat.cwd; the worktree path is unused.

    let pty: PtyProcess;
    try {
      pty = spawnPty({
        shell: this.claudeBin,
        args,
        cwd: chat.cwd,
        useHelper: this.useHelper,
      });
    } catch (err: any) {
      // Could be ENOENT for `claude`, or no permission to chat.cwd. Surface as
      // a synthetic exited session so the WS layer can pass an error through.
      const fakeSession: ChatSession = {
        chatId: chat.id,
        pty: failingPty(err?.message ?? "spawn failed"),
        buffer: `[nora] failed to spawn ${this.claudeBin}: ${err?.message ?? err}\r\n`,
        clients: new Set(),
        drainTimer: null,
        exited: true,
        exitCode: -1,
        watcher: null,
        latestTasks: null,
      };
      return fakeSession;
    }

    const session: ChatSession = {
      chatId: chat.id,
      pty,
      buffer: "",
      clients: new Set(),
      drainTimer: null,
      exited: false,
      exitCode: null,
      watcher: null,
      latestTasks: null,
    };

    // Spin up the transcript watcher for the TASKS side-panel. Disabled
    // in tests that don't care about the side-effect.
    if (!this.disableTranscriptWatcher && chat.session_id) {
      const watcher = new TranscriptWatcher(chat.session_id, chat.cwd, {
        claudeHome: this.claudeHome,
      });
      watcher.on("tasks", (tasks: Task[]) => {
        session.latestTasks = tasks;
        for (const listener of this.tasksListeners) {
          try {
            listener(chat.id, tasks);
          } catch {}
        }
      });
      // Errors are non-fatal — log to stderr but keep the chat alive.
      watcher.on("error", (err: Error) => {
        console.warn(`[nora] transcript watcher error for ${chat.id}: ${err.message}`);
      });
      session.watcher = watcher;
      // Fire-and-forget; the tailer falls back to a parent watcher when
      // the JSONL file doesn't exist yet (claude creates it on first write).
      watcher.start().catch((err) => {
        console.warn(`[nora] transcript watcher start failed for ${chat.id}: ${(err as Error).message}`);
      });
    }

    this.store.chats.setPid(chat.id, pty.pid);

    pty.onData((chunk) => {
      session.buffer += chunk;
      // Cap the replay buffer at ~256 KB so memory doesn't grow unbounded.
      if (session.buffer.length > 256 * 1024) {
        session.buffer = session.buffer.slice(-128 * 1024);
      }
      const payload = JSON.stringify({
        kind: "pty-out",
        "chat-id": chat.id,
        body: { data: chunk },
      });
      for (const client of session.clients) {
        try {
          client.send(payload);
        } catch {}
      }
    });

    pty.onExit((evt) => {
      session.exited = true;
      session.exitCode = evt.exitCode;
      const payload = JSON.stringify({
        kind: "pty-exit",
        "chat-id": chat.id,
        body: { exitCode: evt.exitCode, signal: evt.signal },
      });
      for (const client of session.clients) {
        try {
          client.send(payload);
        } catch {}
      }
      try {
        session.watcher?.stop();
      } catch {}
      this.store.chats.setPid(chat.id, null);
      this.store.chats.markInert(chat.id);
      this.sessions.delete(chat.id);
    });

    return session;
  }

  // Test helpers.
  __test__sessions(): Map<string, ChatSession> {
    return this.sessions;
  }
}

function failingPty(message: string): PtyProcess {
  return {
    pid: -1,
    write() {},
    resize() {},
    kill() {},
    onData(cb) {
      // Deliver the failure message asynchronously so callers can wire up
      // listeners before the message arrives.
      setImmediate(() => cb(`[nora] ${message}\r\n`));
      return () => {};
    },
    onExit(cb) {
      setImmediate(() => cb({ exitCode: -1, signal: null }));
      return () => {};
    },
  };
}
