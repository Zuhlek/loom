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
  PendingQuestion,
  PlanProposedItem,
  SystemNoticeItem,
  Task,
  ToolResultImage,
  TurnState,
  UserMessageItem,
} from "../chat-protocol/messages.ts";
import type { ServerFrame, WirePermissionMode } from "../chat-protocol/frames.ts";

// Re-export so existing `import { Task } from ".../claude-session-bridge.ts"`
// call sites (if any are introduced in future) keep working. The single
// source of truth is `chat-protocol/messages.ts`.
export type { Task };

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

interface PendingQuestionState {
  pending: PendingQuestion;
  /**
   * Reuses the SDK PermissionResult shape — AskUserQuestion is a
   * permission-gated read-only tool whose "answer" is returned to
   * Claude as the resolved permission result's `updatedInput`.
   */
  resolve: (result: PermissionResult) => void;
  toolUseID: string;
}

/**
 * T-003. Tracks the latest pending `plan-proposed` item so Accept /
 * Reject can correlate the user's button click back to the originating
 * ExitPlanMode tool_use. Only one plan can be in-flight per session
 * (the SDK only emits one tool_use at a time, and ExitPlanMode runs
 * inside a single turn) — Design `## In-memory state`.
 */
interface PendingPlanProposal {
  /** `PlanProposedItem.id`; not the SDK tool_use id. */
  itemId: string;
  /** SDK tool_use id of the originating `ExitPlanMode` call. */
  sourceToolUseId: string;
  /** Lifecycle. */
  status: "pending" | "accepted" | "rejected";
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
  /** US-001. Active AskUserQuestion request, if any. Only one in-flight per session. */
  pendingQuestion: PendingQuestionState | null;
  /** T-003 / US-003. Latest pending plan proposal, if any. */
  pendingPlan: PendingPlanProposal | null;
  /** Generation counter; bumped on respawn so stale callbacks are ignored. */
  generation: number;
  clients: Set<WsClient>;
  drainTimer: NodeJS.Timeout | null;
  /** Latest TodoWrite tasks snapshot, derived from tool_use blocks. */
  latestTasks: Task[] | null;
  /** Current turn id used to group items. Bumped on each user turn. */
  currentTurnId: string;
  /**
   * T-001 / US-001. SDK-level `message.id` captured from the most recent
   * `message_start` event. Set in `onPartial`'s `message_start` branch;
   * read by `resolveAssistantItemId` on every subsequent
   * `content_block_*` event; cleared on `message_stop`. Bridge-internal;
   * never serialised on the wire.
   */
  currentMessageStartId: string | null;
}

/**
 * T-002 / US-002 (ADR-004). Dense-array filler block used to backfill
 * sparse intermediate slots before a `content_block_start` index write.
 * `_placeholder: true` survives `JSON.stringify` (it's a normal own
 * property) and is filtered by the web's `AssistantRow.map` before
 * discrimination — the marker is excess metadata on an otherwise legal
 * `AssistantTextBlock`, NOT a new wire variant.
 */
function makePlaceholderBlock(): AssistantBlock {
  return { type: "text", text: "", _placeholder: true };
}

/**
 * T-002 / US-002 AC-1, AC-2 (ADR-004). Ensure the blocks array is dense
 * up to (but not including) `targetIdx` by pushing placeholder blocks.
 * Called BEFORE every `aitem.blocks[idx] = ...` write in the
 * `content_block_start` branch so the array never carries sparse holes
 * that `JSON.stringify` would emit as literal `null`s on the wire.
 *
 * Idempotent when `aitem.blocks.length >= targetIdx` — the loop body
 * never runs. The web's `AssistantRow.map` filters the placeholder
 * blocks out before block-type discrimination.
 */
function ensureDense(blocks: AssistantBlock[], targetIdx: number): void {
  while (blocks.length < targetIdx) {
    blocks.push(makePlaceholderBlock());
  }
}

/**
 * T-001 / US-001 AC-1, AC-5 (ADR-003). Resolve the stable assistant-item
 * id for a streaming partial. Prefers the SDK-level `message.id`
 * captured from the most recent `message_start` event on this session.
 * Falls back to `msg.uuid` ONLY if no `message_start` was observed before
 * the first `content_block_start` for this partial-stream — logs a
 * warning, since the SDK's typed event union and the underlying Messages
 * SSE spec both guarantee `message_start` precedence. The fallback is an
 * audit trail, not a graceful-recovery path.
 */
function resolveAssistantItemId(
  session: ChatSession,
  msg: SDKPartialAssistantMessage,
): string {
  if (session.currentMessageStartId) return session.currentMessageStartId;
  console.warn(
    "[claude-session-bridge] message_start was not observed before " +
      "content_block_start; falling back to msg.uuid keying. " +
      `chatId=${session.chatId} turnId=${session.currentTurnId} uuid=${msg.uuid}`,
  );
  return msg.uuid;
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

  /**
   * Forward a `user-turn` frame from a WS client. Thin wrapper around
   * `submitUserTurnWithPriority(text, "now")` — the SDK-side priority
   * default per US-007 / ADR-004.
   */
  submitUserTurn(chatId: string, text: string): void {
    this.submitUserTurnWithPriority(chatId, text, "now");
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
      pendingQuestion: null,
      pendingPlan: null,
      generation: 0,
      clients: new Set(),
      drainTimer: null,
      latestTasks: null,
      currentTurnId: randomUUID(),
      currentMessageStartId: null,
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
    // T-001 / US-001 AC-4 (ADR-007). Key by `msg.message.id` so the
    // streaming row (created by `onPartial` under the same id) coalesces
    // with the canonical final-assistant row. `msg.uuid` is the SDK-event
    // UUID and is NOT the same string as `msg.message.id`. Without this
    // paired migration the final-message path would `appendItem` a new
    // row and US-001 AC-4 ("never more than one assistant-message row
    // per `message.id`") would be unimplementable.
    const messageId = (msg.message as { id?: string }).id;
    if (typeof messageId !== "string" || messageId.length === 0) {
      console.warn(
        "[claude-session-bridge] SDKAssistantMessage missing message.id; " +
          `falling back to msg.uuid keying. chatId=${session.chatId} uuid=${msg.uuid}`,
      );
    }
    const id =
      typeof messageId === "string" && messageId.length > 0
        ? messageId
        : msg.uuid;
    const blocks: AssistantBlock[] = [];
    const content = (msg.message as { content?: unknown[] }).content;
    // T-003: collect ExitPlanMode tool_use blocks for post-pass dispatch.
    // We append the parent assistant message first (audit trail per
    // Design `## Plan-proposed lifecycle`), then emit one
    // `plan-proposed` item per ExitPlanMode block found.
    const planProposals: Array<{ toolUseId: string; planText: string }> = [];
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
          if (tb.name === "ExitPlanMode") {
            const planText = typeof (tb.input as { plan?: unknown }).plan === "string"
              ? (tb.input as { plan: string }).plan
              : "";
            planProposals.push({ toolUseId: tb.id, planText });
          }
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

    // T-003 / US-003 AC1: emit a `plan-proposed` item for each
    // ExitPlanMode tool_use observed on this assistant message. Per
    // Design `## Failure modes`: empty plan body → append a
    // `system-notice` and skip the plan-proposed item.
    for (const proposal of planProposals) {
      this.handlePlanProposal(session, proposal.planText, proposal.toolUseId);
    }

    this.maybeUpdateTasks(session);
  }

  /** Apply a streaming delta (text or tool_use input fragment). */
  private onPartial(session: ChatSession, msg: SDKPartialAssistantMessage): void {
    const event = msg.event;
    if (!event || typeof event !== "object") return;

    const t = (event as { type?: string }).type;

    // T-001 / US-001 AC-1. Capture `event.message.id` BEFORE any item
    // lookup so subsequent content_block_* branches use the stable id.
    // `message_start` is the first event for any logical Claude message
    // per the SDK's typed event union (BetaRawMessageStartEvent precedes
    // any content block). No item is created on this branch — the next
    // content_block_start does the create-or-update work.
    if (t === "message_start") {
      const startEvent = event as { message?: { id?: string } };
      const messageId = startEvent.message?.id;
      if (typeof messageId === "string" && messageId.length > 0) {
        session.currentMessageStartId = messageId;
      }
      return;
    }

    // Stable-id resolver (replaces the old `const id = msg.uuid`).
    const id = resolveAssistantItemId(session, msg);
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

    if (t === "content_block_start") {
      const idx = (event as { index?: number }).index ?? aitem.blocks.length;
      // T-002 / US-002 AC-1 (ADR-004). Backfill sparse intermediate
      // slots BEFORE the index write so the array stays dense
      // end-to-end and survives `JSON.stringify` without holes
      // becoming literal `null`s. No-op when `idx <=
      // aitem.blocks.length`.
      ensureDense(aitem.blocks, idx);
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
      } else {
        // T-002 / US-002. Unknown block type — leave the placeholder at
        // `idx` rather than overwriting with `undefined` (which would
        // re-introduce a sparse hole). The web's AssistantRow filters
        // placeholders before discrimination, so the unknown slot
        // renders as nothing (US-002 AC-5).
        if (aitem.blocks.length === idx) {
          aitem.blocks.push(makePlaceholderBlock());
        }
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
      // T-001 / US-001 AC-3. Clear the per-message scratch so the NEXT
      // SDK message within the same user turn (multi-tool case) starts
      // a fresh message_start → currentMessageStartId chain.
      aitem.streaming = false;
      session.currentMessageStartId = null;
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
      const flattened = flattenResultContent(b.content);
      target.result = {
        text: flattened.text,
        isError: !!b.is_error,
        ...(flattened.images && flattened.images.length > 0
          ? { images: flattened.images }
          : {}),
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
    // US-001 AC1. AskUserQuestion is permission-gated by the SDK, but
    // the UI surface is a dedicated picker (not the generic permission
    // card). Branch here before the pending-permission path so the
    // question + options surface on a typed `pending-question` frame.
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(session, input, ctx);
    }

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

  /**
   * US-001 AC1. Parse an AskUserQuestion tool input into a
   * `PendingQuestion`, broadcast a `pending-question` frame, and stash
   * the SDK's `resolve` closure so `respondToQuestion` can drive it
   * when the user submits the picker.
   *
   * The SDK's AskUserQuestion input shape (per t3code's contract):
   *   {
   *     question: string,
   *     options: Array<{ id: string; label: string; description?: string }>,
   *     multiSelect?: boolean,
   *     header?: string,
   *   }
   * The bridge parses defensively — non-conforming inputs are coerced
   * to empty-options + raw-string question so the picker can still
   * render a "no options provided" state without throwing.
   */
  private handleAskUserQuestion(
    session: ChatSession,
    input: Record<string, unknown>,
    ctx: {
      signal: AbortSignal;
      toolUseID: string;
    },
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const id = randomUUID();
      const question = typeof input.question === "string" ? input.question : "";
      const options = Array.isArray(input.options)
        ? (input.options as unknown[]).flatMap((o) => {
            const r = o as { id?: unknown; label?: unknown; description?: unknown };
            if (typeof r.id !== "string" || typeof r.label !== "string") return [];
            const opt: { id: string; label: string; description?: string } = {
              id: r.id,
              label: r.label,
            };
            if (typeof r.description === "string") opt.description = r.description;
            return [opt];
          })
        : [];
      const multiSelect = input.multiSelect === true;
      const pending: PendingQuestion = {
        id,
        question,
        options,
        multiSelect,
      };
      session.pendingQuestion = {
        pending,
        resolve,
        toolUseID: ctx.toolUseID,
      };
      this.broadcast(session, {
        kind: "pending-question",
        "chat-id": session.chatId,
        body: pending,
      });
      // If the SDK aborts before we get a response, deny so the promise
      // resolves and the bridge doesn't leak.
      ctx.signal.addEventListener(
        "abort",
        () => {
          if (session.pendingQuestion?.pending.id === id) {
            session.pendingQuestion = null;
            this.broadcast(session, {
              kind: "pending-question",
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

  /**
   * US-004. Push a permission-mode change through to the live SDK Query
   * handle so the SDK's tool-gate behaviour switches immediately. Per
   * ADR-004, calls are NOT debounced or coalesced; each invocation is
   * forwarded to the SDK in-order. No-op when the chat has no live
   * session (the next attach will spawn with whatever `permission_mode`
   * the chat row holds).
   */
  async setPermissionMode(chatId: string, mode: WirePermissionMode): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const queryHandle = session.queryHandle;
    if (!queryHandle) return;
    try {
      await queryHandle.setPermissionMode(mode as SdkPermissionMode);
    } catch (err) {
      // Surface the failure as a session-scoped notice. Per design's
      // `## Failure modes`, we do NOT roll back any user-turn that was
      // already queued — the user explicitly asked for both.
      const message = err instanceof Error ? err.message : String(err);
      this.appendItem(session, makeNotice(`Permission mode change failed: ${message}`, "error"));
    }
  }

  /**
   * US-004 / US-007. Submit a user-turn with an explicit SDK priority
   * field. The priority is set on the `SDKUserMessage` pushed onto the
   * input queue; the SDK-side scheduler does the actual prioritisation
   * (the bridge's queue stays FIFO per ADR-004).
   */
  submitUserTurnWithPriority(
    chatId: string,
    text: string,
    priority: "now" | "next" | "later",
  ): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    session.currentTurnId = randomUUID();
    // T-001 / US-001. Reset the per-message scratch id at every turn
    // boundary for symmetry with the state-flow diagram in design.md.
    // A new message_start will populate it for the first SDK message
    // of the new turn.
    session.currentMessageStartId = null;
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
      priority,
    });
  }

  /**
   * T-003 / US-003 AC3. Accept the latest pending plan proposal.
   *
   * Side-effect chain (per Design `## Plan-proposed lifecycle`):
   *   1. `Query.setPermissionMode("default")` on the live SDK Query
   *      handle — permission gate reverts so the next user-turn
   *      executes tools without the plan-mode lockout.
   *   2. Queue a "Please execute the plan as proposed" user-turn via
   *      the existing `submitUserTurnWithPriority(text, "now")` path.
   *   3. Flip the plan-proposed item's `status` to `"accepted"` and
   *      broadcast an `item-update` so attached clients re-render the
   *      card with greyed-out controls.
   *
   * Per ADR-004 the `setPermissionMode` call is NOT debounced and is
   * NOT coalesced with composer-footer selector changes. Per ADR-004
   * (3) we also do NOT auto-submit any composer draft on Accept — only
   * the canonical execute user-turn is queued. Defensive guards drop
   * the call when no matching pending plan exists in the session.
   */
  async acceptPlanProposal(chatId: string, planId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const item = session.itemsById.get(planId);
    if (!item || item.kind !== "plan-proposed") return;
    if (item.status !== "pending") return;

    // 1. Flip permission mode back to default. Errors surface as a
    //    session-scoped system-notice via the existing wrapper; we do
    //    NOT roll back the queued user-turn (Design `## Failure modes`).
    await this.setPermissionMode(chatId, "default");
    // 2. Queue the execute user-turn. The text is canonical (Plan-time
    //    constant) so the user gets the same observable outcome whether
    //    they type it themselves or click Accept.
    this.submitUserTurnWithPriority(
      chatId,
      "Please execute the plan as proposed.",
      "now",
    );
    // 3. Flip the item status and broadcast item-update.
    item.status = "accepted";
    if (session.pendingPlan && session.pendingPlan.itemId === planId) {
      session.pendingPlan.status = "accepted";
      session.pendingPlan = null;
    }
    this.updateItem(session, item);
  }

  /**
   * T-003 / US-003 AC4. Reject the latest pending plan proposal.
   *
   * Queues a "Please reconsider the plan; do not execute it as-is"
   * user-turn via `submitUserTurnWithPriority(text, "now")` and flips
   * the item's status to `"rejected"`. Permission mode is left
   * unchanged — the SDK remains in `"plan"` per AC4.
   */
  async rejectPlanProposal(chatId: string, planId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const item = session.itemsById.get(planId);
    if (!item || item.kind !== "plan-proposed") return;
    if (item.status !== "pending") return;

    // Queue the reconsider user-turn. Per AC4 permission mode is left
    // unchanged — the SDK stays in "plan" so Claude knows to issue a
    // revised plan rather than start executing.
    this.submitUserTurnWithPriority(
      chatId,
      "Please reconsider the plan; do not execute it as-is.",
      "now",
    );
    item.status = "rejected";
    if (session.pendingPlan && session.pendingPlan.itemId === planId) {
      session.pendingPlan.status = "rejected";
      session.pendingPlan = null;
    }
    this.updateItem(session, item);
  }

  /**
   * T-003 / US-003 AC1. Emit a `plan-proposed` ChatItem in response to
   * an observed `ExitPlanMode` tool_use. Sets `session.pendingPlan` so
   * the matching Accept/Reject frame can find the item by id without
   * re-parsing the tool_use block.
   *
   * Empty / non-string plan bodies append a `system-notice` and skip
   * the plan-proposed item per Design `## Failure modes`.
   */
  private handlePlanProposal(
    session: ChatSession,
    planText: string,
    sourceToolUseId: string,
  ): void {
    if (typeof planText !== "string" || planText.trim() === "") {
      this.appendItem(
        session,
        makeNotice("Plan proposal arrived with empty body — ignored.", "info"),
      );
      return;
    }

    const item: PlanProposedItem = {
      kind: "plan-proposed",
      id: randomUUID(),
      ts: Date.now(),
      planText,
      status: "pending",
    };
    this.appendItem(session, item);
    session.pendingPlan = {
      itemId: item.id,
      sourceToolUseId,
      status: "pending",
    };
  }

  /**
   * US-001 AC5. Resolve a pending AskUserQuestion request.
   *
   * AskUserQuestion is permission-gated by the SDK; the bridge replies
   * with `behavior: "allow"` and packs the user's selected answers
   * into `updatedInput` so the SDK forwards them back to Claude as the
   * tool's effective input. This mirrors t3code's resolution path
   * (Design `## Bridge interface additions`).
   *
   * Stale / mismatched ids are dropped silently per Design
   * `## Failure modes` (the slow-client guard); the matching
   * `pending-question {body: null}` clearing frame is emitted on the
   * happy path when the question is consumed.
   */
  respondToQuestion(
    chatId: string,
    id: string,
    answer: { answers: string[]; otherText?: string },
  ): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const pending = session.pendingQuestion;
    if (!pending || pending.pending.id !== id) return;

    // Pack the user's answer into the SDK-bound PermissionResult. The
    // SDK's `updatedInput` field is the channel Claude reads the
    // AskUserQuestion result from — we preserve the original input
    // keys and overlay the chosen answers + optional otherText.
    const updatedInput: Record<string, unknown> = {
      answers: answer.answers,
    };
    if (answer.otherText !== undefined && answer.otherText !== "") {
      updatedInput.otherText = answer.otherText;
    }

    pending.resolve({
      behavior: "allow",
      updatedInput,
      toolUseID: pending.toolUseID,
    });
    session.pendingQuestion = null;
    this.broadcast(session, {
      kind: "pending-question",
      "chat-id": session.chatId,
      body: null,
    });
  }

  // Test helpers.
  __test__sessions(): Map<string, ChatSession> {
    return this.sessions;
  }

  /**
   * US-001 AC1 / red phase. Synthetic entry point used by the T-002
   * test suite to exercise `handleCanUseTool` without spinning up a
   * real SDK session. Mirrors the SDK's `canUseTool` callback signature.
   *
   * Returns the same promise the SDK would await; tests can resolve it
   * by invoking `respondToQuestion` (post-implementation) and observe
   * the broadcast side effects.
   */
  __test__invokeCanUseTool(
    chatId: string,
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
    const session = this.sessions.get(chatId);
    if (!session) {
      return Promise.reject(new Error(`__test__invokeCanUseTool: no session for ${chatId}`));
    }
    return this.handleCanUseTool(session, toolName, input, ctx);
  }

  /**
   * T-006 red phase. Synthetic entry point used by the
   * `bridge-image-flatten.test.ts` suite to push a hand-crafted
   * SDKMessage through the bridge's dispatch path (`handleSdkMessage`)
   * without driving the real SDK. Exposes private routing for unit
   * tests; production code paths go through `runLoop` instead.
   */
  __test__handleSdkMessage(chatId: string, msg: unknown): void {
    const session = this.sessions.get(chatId);
    if (!session) {
      throw new Error(`__test__handleSdkMessage: no session for ${chatId}`);
    }
    this.handleSdkMessage(session, msg as SDKMessage);
  }

  /**
   * Install a synthetic session for unit tests, bypassing the real SDK
   * spawn. Either a `setPermissionMode` stub (for setPermissionMode
   * tests) or a `capture` callback (for queue tests) may be supplied;
   * unspecified fields are no-ops.
   */
  __test__installStubSession(
    chatId: string,
    opts: {
      setPermissionMode?: (mode: WirePermissionMode) => Promise<void>;
      capture?: (msg: SDKUserMessage) => void;
    },
  ): void {
    const inputQueue = new UserMessageQueue();
    if (opts.capture) {
      const origPush = inputQueue.push.bind(inputQueue);
      inputQueue.push = (msg: SDKUserMessage) => {
        opts.capture!(msg);
        origPush(msg);
      };
    }
    const queryHandle = {
      setPermissionMode: opts.setPermissionMode ?? (async () => undefined),
      interrupt: async () => undefined,
    } as unknown as Query;
    const session: ChatSession = {
      chatId,
      cwd: "/tmp",
      permissionMode: "default",
      sessionId: "stub-session",
      inputQueue,
      abortController: new AbortController(),
      queryHandle,
      items: [],
      itemsById: new Map(),
      toolUseToAssistantId: new Map(),
      turnState: "idle",
      lastError: undefined,
      pendingPermission: null,
      pendingQuestion: null,
      pendingPlan: null,
      generation: 0,
      clients: new Set(),
      drainTimer: null,
      latestTasks: null,
      currentTurnId: randomUUID(),
      currentMessageStartId: null,
    };
    this.sessions.set(chatId, session);
  }
}

function snapshotFrame(session: ChatSession): ServerFrame {
  const snapshot: ChatSnapshot = {
    items: session.items,
    turnState: session.turnState,
    lastError: session.lastError,
    pendingPermission: session.pendingPermission?.pending ?? null,
    pendingQuestion: session.pendingQuestion?.pending ?? null,
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

/**
 * Walk the SDK tool_result `content` payload and split it into a text
 * digest + an optional list of image blocks. Renamed from
 * `flattenResultText` to reflect the broader scope (Design ADR-007).
 *
 * The SDK delivers tool_result content in one of two shapes:
 *   - a plain string body (some MCP tools); or
 *   - an array of blocks: `{ type: "text", text }` /
 *     `{ type: "image", source: { type: "base64", media_type, data } }`.
 *
 * Per Design ADR-006 image bytes are passed through to the wire as
 * base-64 + media-type (NOT blob URLs, NOT a server-route fetch). The
 * web client constructs a `data:<mediaType>;base64,<dataB64>` URL on
 * render.
 */
function flattenResultContent(
  content: unknown,
): { text: string; images?: ToolResultImage[] } {
  if (typeof content === "string") return { text: truncate(content) };
  if (!Array.isArray(content)) return { text: "" };
  const parts: string[] = [];
  const images: ToolResultImage[] = [];
  for (const block of content) {
    const b = block as {
      type?: string;
      text?: string;
      source?: { type?: string; media_type?: string; data?: string };
    };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
      continue;
    }
    if (b.type === "image" && b.source && b.source.type === "base64") {
      const mediaType = typeof b.source.media_type === "string" ? b.source.media_type : "";
      const dataB64 = typeof b.source.data === "string" ? b.source.data : "";
      // Per ADR-007: drop silently if either field is missing; do not
      // emit a partial image entry. Empty payloads would render as a
      // broken image regardless.
      if (mediaType && dataB64) {
        images.push({ mediaType, dataB64 });
      }
    }
  }
  const text = truncate(parts.join("\n"));
  return images.length > 0 ? { text, images } : { text };
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
