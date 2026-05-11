/**
 * ClaudeSessionBridge — per-chat Claude session driven by the Claude
 * Agent SDK.
 *
 * Replaces the older PTY-based bridge. Each chat owns a long-lived
 * `query()` invocation whose `prompt` is an async iterable that the
 * bridge pushes user turns into. The SDK yields typed messages
 * (assistant, user, result, partial assistant, system…) which the
 * bridge translates into the structured `ChatItem` protocol the web
 * client renders directly — no TUI bytes, no xterm.
 *
 * Lifecycle parity with the old bridge:
 *   - Lazy-spawn on first attach.
 *   - First spawn uses `sessionId`; respawn after drain uses `resume`.
 *   - 30 s drain timer when the last client disconnects; abort the
 *     query and mark the chat row inert if no one reattaches.
 *
 * Permission flow:
 *   - The SDK invokes `canUseTool` before each tool call. The bridge
 *     stashes a `PendingPermission` snapshot + a Promise resolver,
 *     broadcasts `pending-permission`, and waits for the matching
 *     `permission-response` frame.
 *
 * Tasks (TodoWrite) side-panel:
 *   - Watched directly off the assistant `tool_use` blocks rather than
 *     via the JSONL transcript watcher — same payload, simpler path.
 */
import { randomUUID } from "node:crypto";
import {
  query,
  type Options,
  type PermissionMode as SdkPermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatRow } from "../metadata-store/repos/chat.ts";

type PermissionMode = ChatRow["permission_mode"];
import type {
  AssistantBlock,
  AssistantMessageItem,
  AssistantToolUseBlock,
  ChatItem,
  ChatSnapshot,
  PendingPermission,
  SystemNoticeItem,
  TurnState,
  UserMessageItem,
} from "../chat-protocol/messages.ts";
import type { ServerFrame } from "../chat-protocol/frames.ts";

export interface WsClient {
  send(text: string): void;
  close?(): void;
}

export interface BridgeOptions {
  /** Absolute path to the claude executable to use. */
  pathToClaudeCodeExecutable?: string;
  /** Drain delay in ms before aborting the query after the last client leaves. */
  drainMs?: number;
}

export type TasksUpdateListener = (chatId: string, tasks: Task[]) => void;

export interface Task {
  step: string;
  status: "pending" | "inProgress" | "completed";
  activeForm?: string;
}

const DEFAULT_DRAIN_MS = 30_000;

/** Minimum unbounded async queue used as the SDK input iterable. */
class UserMessageQueue {
  private queue: SDKUserMessage[] = [];
  private resolvers: ((v: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ value: msg, done: false });
    else this.queue.push(msg);
  }

  close(): void {
    this.closed = true;
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          if (this.queue.length > 0) {
            resolve({ value: this.queue.shift()!, done: false });
            return;
          }
          if (this.closed) {
            resolve({ value: undefined as unknown as SDKUserMessage, done: true });
            return;
          }
          this.resolvers.push(resolve);
        }),
    };
  }
}

interface PendingPermissionState {
  pending: PendingPermission;
  resolve: (result: PermissionResult) => void;
  suggestions: PermissionUpdate[];
}

interface ChatSession {
  chatId: string;
  cwd: string;
  permissionMode: PermissionMode;
  /** SDK session id (matches the row's session_id). */
  sessionId: string;
  inputQueue: UserMessageQueue;
  abortController: AbortController;
  queryHandle: Query | null;
  items: ChatItem[];
  /** Indexed by item.id for quick mutation when streaming/tool updates land. */
  itemsById: Map<string, ChatItem>;
  /** Tracks which assistant message holds a given tool_use_id, for result wiring. */
  toolUseToAssistantId: Map<string, string>;
  turnState: TurnState;
  lastError: string | undefined;
  pendingPermission: PendingPermissionState | null;
  /** Generation counter; bumped on respawn so stale callbacks are ignored. */
  generation: number;
  clients: Set<WsClient>;
  drainTimer: NodeJS.Timeout | null;
  /** Latest TodoWrite tasks snapshot, derived from tool_use blocks. */
  latestTasks: Task[] | null;
  /** Current turn id used to group items. Bumped on each user turn. */
  currentTurnId: string;
}

export class ClaudeSessionBridge {
  private sessions = new Map<string, ChatSession>();
  private drainMs: number;
  private pathToClaudeCodeExecutable: string | undefined;
  private tasksListeners = new Set<TasksUpdateListener>();

  constructor(private store: MetadataStore, opts: BridgeOptions = {}) {
    this.drainMs = opts.drainMs ?? DEFAULT_DRAIN_MS;
    this.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;
  }

  onTasksUpdate(cb: TasksUpdateListener): () => void {
    this.tasksListeners.add(cb);
    return () => this.tasksListeners.delete(cb);
  }

  getLatestTasks(chatId: string): Task[] | null {
    return this.sessions.get(chatId)?.latestTasks ?? null;
  }

  /** Attach a WS client; lazy-spawn the session if needed. Sends a snapshot. */
  attach(chatId: string, client: WsClient): void {
    let session = this.sessions.get(chatId);
    if (!session) {
      const chat = this.store.chats.get(chatId);
      if (!chat) throw new Error(`chat not found: ${chatId}`);
      session = this.spawn(chat);
      this.sessions.set(chatId, session);
    }

    if (session.drainTimer) {
      clearTimeout(session.drainTimer);
      session.drainTimer = null;
    }

    session.clients.add(client);
    this.sendTo(client, snapshotFrame(session));
  }

  detach(chatId: string, client: WsClient): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    session.clients.delete(client);
    if (session.clients.size > 0) return;
    // Last client just left — start the drain timer.
    session.drainTimer = setTimeout(() => {
      this.disposeSession(session, { markInert: true });
    }, this.drainMs);
  }

  /** Drop the session entirely (used on chat delete). */
  dispose(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    this.disposeSession(session, { markInert: false });
  }

  /** Forward a `user-turn` frame from a WS client. */
  submitUserTurn(chatId: string, text: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    session.currentTurnId = randomUUID();
    const item: UserMessageItem = {
      kind: "user-message",
      id: randomUUID(),
      turnId: session.currentTurnId,
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    this.appendItem(session, item);
    this.setTurnState(session, "running");

    session.inputQueue.push({
      type: "user",
      message: { role: "user", content: trimmed },
      parent_tool_use_id: null,
      session_id: session.sessionId,
    });
  }

  /** Forward an `interrupt` frame from a WS client. */
  interrupt(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    try {
      session.queryHandle?.interrupt();
    } catch {
      try {
        session.abortController.abort();
      } catch {}
    }
    this.setTurnState(session, "interrupted");
  }

  /** Resolve a pending permission request. */
  respondToPermission(
    chatId: string,
    id: string,
    behavior: "allow" | "deny",
    opts: { remember?: boolean; message?: string } = {},
  ): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const pending = session.pendingPermission;
    if (!pending || pending.pending.id !== id) return;

    if (behavior === "allow") {
      pending.resolve({
        behavior: "allow",
        updatedPermissions: opts.remember ? pending.suggestions : undefined,
        toolUseID: pending.pending.toolUseId,
      });
    } else {
      pending.resolve({
        behavior: "deny",
        message: opts.message ?? "User denied permission.",
        toolUseID: pending.pending.toolUseId,
      });
    }
    session.pendingPermission = null;
    this.broadcast(session, {
      kind: "pending-permission",
      "chat-id": session.chatId,
      body: null,
    });
  }

  // ─── Internal ────────────────────────────────────────────────────

  private spawn(chat: ChatRow): ChatSession {
    const inputQueue = new UserMessageQueue();
    const abortController = new AbortController();
    const sessionId = chat.session_id ?? randomUUID();
    if (!chat.session_id) {
      this.store.chats.setSessionId(chat.id, sessionId);
    }

    const session: ChatSession = {
      chatId: chat.id,
      cwd: chat.cwd,
      permissionMode: chat.permission_mode,
      sessionId,
      inputQueue,
      abortController,
      queryHandle: null,
      items: [],
      itemsById: new Map(),
      toolUseToAssistantId: new Map(),
      turnState: "idle",
      lastError: undefined,
      pendingPermission: null,
      generation: 0,
      clients: new Set(),
      drainTimer: null,
      latestTasks: null,
      currentTurnId: randomUUID(),
    };

    const sdkOptions: Options = {
      cwd: chat.cwd,
      abortController,
      includePartialMessages: true,
      canUseTool: (toolName, input, ctx) =>
        this.handleCanUseTool(session, toolName, input, ctx),
      pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable,
    };

    const sdkPermissionMode = toSdkPermissionMode(chat.permission_mode);
    if (sdkPermissionMode) sdkOptions.permissionMode = sdkPermissionMode;
    if (chat.permission_mode === "trusted-vm") {
      sdkOptions.allowDangerouslySkipPermissions = true;
    }

    if (chat.inert) {
      sdkOptions.resume = sessionId;
    } else {
      sdkOptions.sessionId = sessionId;
    }

    const queryHandle = query({ prompt: inputQueue, options: sdkOptions });
    session.queryHandle = queryHandle;

    // PID isn't surfaced by the SDK; the older bridge stored it for the
    // sidebar's running-state badge. We mark active here and clear it
    // when the session terminates.
    this.store.chats.markActive(chat.id);

    // Drive the SDK loop in the background. Any throws end the session.
    this.runLoop(session, queryHandle).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      session.lastError = message;
      this.setTurnState(session, "error");
      this.appendItem(session, makeNotice(`Session error: ${message}`, "error"));
      this.store.chats.markInert(chat.id);
    });

    return session;
  }

  private async runLoop(session: ChatSession, q: Query): Promise<void> {
    for await (const msg of q) {
      this.handleSdkMessage(session, msg);
    }
    // Iterator ended — session is finished.
    this.store.chats.markInert(session.chatId);
  }

  private handleSdkMessage(session: ChatSession, msg: SDKMessage): void {
    switch (msg.type) {
      case "assistant":
        this.onAssistant(session, msg);
        break;
      case "stream_event":
        this.onPartial(session, msg);
        break;
      case "user":
        this.onUserMessage(session, msg as SDKUserMessage);
        break;
      case "result":
        this.onResult(session, msg as SDKResultMessage);
        break;
      case "system":
        // System messages (e.g. session_state_changed) are not surfaced for now.
        break;
      default:
        // Other SDK message variants are not yet rendered — ignore.
        break;
    }
  }

  /** Materialise an assistant message (post-stream finalised content). */
  private onAssistant(session: ChatSession, msg: SDKAssistantMessage): void {
    const id = msg.uuid;
    const blocks: AssistantBlock[] = [];
    const content = (msg.message as { content?: unknown[] }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as { type?: string };
        if (b.type === "text") {
          const text = (block as { text?: string }).text ?? "";
          blocks.push({ type: "text", text });
        } else if (b.type === "thinking") {
          const text = (block as { thinking?: string }).thinking ?? "";
          blocks.push({ type: "thinking", text });
        } else if (b.type === "tool_use") {
          const tb = block as { id: string; name: string; input: Record<string, unknown> };
          const toolBlock: AssistantToolUseBlock = {
            type: "tool_use",
            id: tb.id,
            name: tb.name,
            input: tb.input ?? {},
            status: "running",
          };
          blocks.push(toolBlock);
          session.toolUseToAssistantId.set(tb.id, id);
        }
      }
    }

    const existing = session.itemsById.get(id);
    const now = new Date().toISOString();
    if (existing && existing.kind === "assistant-message") {
      existing.blocks = blocks;
      existing.streaming = false;
      existing.updatedAt = now;
      this.updateItem(session, existing);
    } else {
      const item: AssistantMessageItem = {
        kind: "assistant-message",
        id,
        turnId: session.currentTurnId,
        blocks,
        streaming: false,
        createdAt: now,
        updatedAt: now,
      };
      this.appendItem(session, item);
    }

    this.maybeUpdateTasks(session);
  }

  /** Apply a streaming delta (text or tool_use input fragment). */
  private onPartial(session: ChatSession, msg: SDKPartialAssistantMessage): void {
    const id = msg.uuid;
    let item = session.itemsById.get(id);
    if (!item || item.kind !== "assistant-message") {
      const now = new Date().toISOString();
      item = {
        kind: "assistant-message",
        id,
        turnId: session.currentTurnId,
        blocks: [],
        streaming: true,
        createdAt: now,
        updatedAt: now,
      } satisfies AssistantMessageItem;
      this.appendItem(session, item);
    }
    const aitem = item as AssistantMessageItem;
    aitem.streaming = true;

    const event = msg.event;
    if (!event || typeof event !== "object") return;

    const t = (event as { type?: string }).type;
    if (t === "content_block_start") {
      const idx = (event as { index?: number }).index ?? aitem.blocks.length;
      const block = (event as { content_block?: unknown }).content_block as
        | { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }
        | undefined;
      if (block?.type === "text") {
        aitem.blocks[idx] = { type: "text", text: block.text ?? "" };
      } else if (block?.type === "thinking") {
        aitem.blocks[idx] = { type: "thinking", text: block.thinking ?? "" };
      } else if (block?.type === "tool_use" && block.id && block.name) {
        const toolBlock: AssistantToolUseBlock = {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input ?? {},
          status: "running",
        };
        aitem.blocks[idx] = toolBlock;
        session.toolUseToAssistantId.set(block.id, id);
      }
    } else if (t === "content_block_delta") {
      const idx = (event as { index?: number }).index ?? 0;
      const delta = (event as { delta?: { type?: string; text?: string; thinking?: string; partial_json?: string } }).delta;
      const target = aitem.blocks[idx];
      if (!target) return;
      if (target.type === "text" && delta?.type === "text_delta" && typeof delta.text === "string") {
        target.text += delta.text;
      } else if (target.type === "thinking" && delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        target.text += delta.thinking;
      }
      // input_json_delta for tool_use is ignored on the fly; the final
      // assistant message carries the parsed input. Showing partial JSON
      // is more noise than signal.
    } else if (t === "message_stop") {
      // Stream finished for this assistant message; final `assistant`
      // message will arrive next with the canonical content.
      aitem.streaming = false;
    }

    aitem.updatedAt = new Date().toISOString();
    this.updateItem(session, aitem);
  }

  /** SDK user messages are tool_result echoes or replayed history on resume. */
  private onUserMessage(session: ChatSession, msg: SDKUserMessage): void {
    const content = (msg.message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      // Plain text user echo — skip; we already appended the user item on submit.
      return;
    }
    for (const block of content) {
      const b = block as {
        type?: string;
        tool_use_id?: string;
        content?: unknown;
        is_error?: boolean;
      };
      if (b.type !== "tool_result" || !b.tool_use_id) continue;
      const assistantId = session.toolUseToAssistantId.get(b.tool_use_id);
      if (!assistantId) continue;
      const item = session.itemsById.get(assistantId);
      if (!item || item.kind !== "assistant-message") continue;
      const target = item.blocks.find(
        (blk): blk is AssistantToolUseBlock => blk.type === "tool_use" && blk.id === b.tool_use_id,
      );
      if (!target) continue;
      target.status = b.is_error ? "error" : "complete";
      target.result = {
        text: flattenResultText(b.content),
        isError: !!b.is_error,
      };
      item.updatedAt = new Date().toISOString();
      this.updateItem(session, item);
    }
  }

  private onResult(session: ChatSession, msg: SDKResultMessage): void {
    if ((msg as { is_error?: boolean }).is_error) {
      const errMsg = (msg as { error?: string; subtype?: string }).error
        ?? (msg as { subtype?: string }).subtype
        ?? "result error";
      session.lastError = errMsg;
      this.setTurnState(session, "error");
    } else {
      this.setTurnState(session, "idle");
    }
  }

  private async handleCanUseTool(
    session: ChatSession,
    toolName: string,
    input: Record<string, unknown>,
    ctx: {
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      title?: string;
      displayName?: string;
      description?: string;
      toolUseID: string;
    },
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const id = randomUUID();
      const pending: PendingPermission = {
        id,
        toolName,
        input,
        title: ctx.title,
        displayName: ctx.displayName,
        description: ctx.description,
        toolUseId: ctx.toolUseID,
      };
      session.pendingPermission = {
        pending,
        resolve,
        suggestions: ctx.suggestions ?? [],
      };
      this.broadcast(session, {
        kind: "pending-permission",
        "chat-id": session.chatId,
        body: pending,
      });
      // If the SDK aborts before we get a response, deny so the promise resolves.
      ctx.signal.addEventListener(
        "abort",
        () => {
          if (session.pendingPermission?.pending.id === id) {
            session.pendingPermission = null;
            this.broadcast(session, {
              kind: "pending-permission",
              "chat-id": session.chatId,
              body: null,
            });
            resolve({ behavior: "deny", message: "Aborted.", toolUseID: ctx.toolUseID });
          }
        },
        { once: true },
      );
    });
  }

  private maybeUpdateTasks(session: ChatSession): void {
    // Find the most recent TodoWrite tool_use across the items and use
    // its `input.todos` as the latest task list.
    for (let i = session.items.length - 1; i >= 0; i--) {
      const it = session.items[i];
      if (!it || it.kind !== "assistant-message") continue;
      for (let j = it.blocks.length - 1; j >= 0; j--) {
        const blk = it.blocks[j];
        if (!blk || blk.type !== "tool_use") continue;
        if (blk.name !== "TodoWrite") continue;
        const todos = (blk.input as { todos?: unknown }).todos;
        if (!Array.isArray(todos)) continue;
        const tasks: Task[] = [];
        for (const t of todos) {
          const r = t as { content?: string; activeForm?: string; status?: string };
          if (!r.content) continue;
          const status: Task["status"] =
            r.status === "in_progress" ? "inProgress"
              : r.status === "completed" ? "completed"
              : "pending";
          tasks.push({ step: r.content, status, activeForm: r.activeForm });
        }
        session.latestTasks = tasks;
        for (const cb of this.tasksListeners) {
          try { cb(session.chatId, tasks); } catch {}
        }
        return;
      }
    }
  }

  private appendItem(session: ChatSession, item: ChatItem): void {
    session.items.push(item);
    session.itemsById.set(item.id, item);
    this.broadcast(session, {
      kind: "item-append",
      "chat-id": session.chatId,
      body: { item },
    });
  }

  private updateItem(session: ChatSession, item: ChatItem): void {
    // Items are mutated in place; rebroadcast as item-update so attached
    // clients can overwrite by id.
    session.itemsById.set(item.id, item);
    this.broadcast(session, {
      kind: "item-update",
      "chat-id": session.chatId,
      body: { item },
    });
  }

  private setTurnState(session: ChatSession, state: TurnState): void {
    if (session.turnState === state) return;
    session.turnState = state;
    this.broadcast(session, {
      kind: "turn-state",
      "chat-id": session.chatId,
      body: { state, lastError: session.lastError },
    });
  }

  private broadcast(session: ChatSession, frame: ServerFrame): void {
    const payload = JSON.stringify(frame);
    for (const client of session.clients) {
      try { client.send(payload); } catch {}
    }
  }

  private sendTo(client: WsClient, frame: ServerFrame): void {
    try { client.send(JSON.stringify(frame)); } catch {}
  }

  private disposeSession(session: ChatSession, opts: { markInert: boolean }): void {
    if (session.drainTimer) {
      clearTimeout(session.drainTimer);
      session.drainTimer = null;
    }
    try { session.abortController.abort(); } catch {}
    try { session.inputQueue.close(); } catch {}
    this.sessions.delete(session.chatId);
    if (opts.markInert) {
      this.store.chats.markInert(session.chatId);
    }
  }

  // Test helpers.
  __test__sessions(): Map<string, ChatSession> {
    return this.sessions;
  }
}

function snapshotFrame(session: ChatSession): ServerFrame {
  const snapshot: ChatSnapshot = {
    items: session.items,
    turnState: session.turnState,
    lastError: session.lastError,
    pendingPermission: session.pendingPermission?.pending ?? null,
    pendingQuestion: null,
  };
  return {
    kind: "snapshot",
    "chat-id": session.chatId,
    body: snapshot,
  };
}

function makeNotice(text: string, level: "info" | "error"): SystemNoticeItem {
  return {
    kind: "system-notice",
    id: randomUUID(),
    text,
    level,
    createdAt: new Date().toISOString(),
  };
}

function flattenResultText(content: unknown): string {
  if (typeof content === "string") return truncate(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return truncate(parts.join("\n"));
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

function toSdkPermissionMode(mode: PermissionMode): SdkPermissionMode | undefined {
  switch (mode) {
    case "default":
      return undefined;
    case "plan":
      return "plan";
    case "accept-edits":
      return "acceptEdits";
    case "trusted-vm":
      return "bypassPermissions";
  }
}
