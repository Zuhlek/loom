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
  type SDKControlGetContextUsageResponse,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";

import type { MetadataStore } from "../metadata-store/index.ts";
import type { ChatRow } from "../metadata-store/repos/chat.ts";
import type { ResolvedConfig } from "../config-loader/index.ts";
import {
  resolveSpawnCwd as defaultResolveSpawnCwd,
  type ResolvedSpawnCwd,
  type SpawnInput,
} from "./resolve-spawn-cwd.ts";
import { isGitRepo as defaultIsGitRepo } from "../git/is-git-repo.ts";
import { createWorktree as defaultCreateWorktree } from "../git/worktree.ts";

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
  SessionLifecycle,
  SystemNoticeItem,
  Task,
  ToolResultImage,
  TurnState,
  UserMessageItem,
} from "../chat-protocol/messages.ts";
import type {
  ServerFrame,
  UserTurnImage,
  WirePermissionMode,
} from "../chat-protocol/frames.ts";
import type { WireSlashCommand } from "../chat-protocol/messages.ts";

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
  /** Resolved config snapshot. Used by resolveSpawnCwd to find worktreesRoot. */
  config?: ResolvedConfig;
  /** Injectable for tests: override the worktree-resolution helper. */
  resolveSpawnCwd?: (input: SpawnInput) => Promise<ResolvedSpawnCwd>;
  /** Test seam: skip the real SDK query and capture the session instead. */
  startQueryOverride?: (session: ChatSession, mode: "create" | "resume") => void;
  /** Test seam: intercept the SDK `query()` factory to capture `Options`. */
  sdkQueryFactory?: (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
}

/** SDK beta flag enabling the 1M context window. */
const CONTEXT_1M_BETA = "context-1m-2025-08-07";

/**
 * Curated set of slash-command names that classify as "skill" rows
 * in the composer slash menu. The SDK `SlashCommand` shape has no
 * `source` / `kind` field, so the bridge annotates each row by name
 * before broadcasting; the client renders from the resulting `kind`.
 * Single source of truth — renaming a skill is one edit here.
 */
export const SKILL_NAMES: ReadonlySet<string> = new Set<string>([
  "weave",
  "idea",
  "forge",
  "tune",
  "build",
  "review",
  "explore-prototype",
  "init",
  "loop",
  "schedule",
  "security-review",
  "simplify",
  "update-config",
  "keybindings-help",
  "fewer-permission-prompts",
  "claude-api",
]);

/** Map an SDK-enumerated SlashCommand to the wire `kind`. */
export function classifySlashCommand(command: SlashCommand): WireSlashCommand["kind"] {
  return SKILL_NAMES.has(command.name) ? "skill" : "command";
}

export type TasksUpdateListener = (chatId: string, tasks: Task[]) => void;

const DEFAULT_DRAIN_MS = 30_000;

/**
 * Auto-recovery backoff schedule (in ms) when the SDK loop throws.
 * Each attempt uses the delay at `attempt - 1`; once the array is
 * exhausted the session transitions to `lifecycle: "failed"` and waits
 * for an explicit `retry-session` from the client. The schedule is
 * t3code-inspired: short enough that transient errors clear quickly,
 * bounded enough that a hard failure stops hammering the SDK.
 */
const RECOVERY_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];

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

  /**
   * Returns all messages buffered in the queue that the SDK iterator
   * never consumed, in FIFO order. Used by `handleSessionFailure` so
   * unflushed user turns survive an SDK crash and are replayed into
   * the fresh queue on respawn. Idempotent: subsequent calls return
   * an empty array.
   */
  drain(): SDKUserMessage[] {
    const drained = this.queue;
    this.queue = [];
    return drained;
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
  /** Original SDK input — echoed back in `updatedInput.questions`. */
  originalInput: Record<string, unknown>;
  /** Question text — used as the key in the SDK's `answers` map. */
  questionText: string;
  /** Map from synthesized option id → original label (for the answers map). */
  optionLabels: Record<string, string>;
}

/**
 * Tracks the latest pending `plan-proposed` item so Accept / Reject
 * can correlate the user's button click back to the originating
 * ExitPlanMode tool_use. Only one plan can be in-flight per session
 * (the SDK only emits one tool_use at a time, and ExitPlanMode runs
 * inside a single turn).
 */
interface PendingPlanProposal {
  /** `PlanProposedItem.id`; not the SDK tool_use id. */
  itemId: string;
  /** SDK tool_use id of the originating `ExitPlanMode` call. */
  sourceToolUseId: string;
  /** Lifecycle. */
  status: "pending" | "accepted" | "rejected";
}

export interface ChatSession {
  chatId: string;
  cwd: string;
  /** Set when the bridge materialised a git worktree for this chat. */
  worktreePath: string | null;
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
  /**
   * Epoch ms when the session most recently entered `turnState === "running"`.
   * Set by `setTurnState` on every idle/error/interrupted → running edge and
   * cleared when leaving running. Echoed on the wire via `ChatSnapshot.turnStartedAt`
   * so a reconnecting client can keep the working-timer counting from the
   * original start rather than restarting at 0 on every navigation/refresh.
   */
  turnStartedAtMs: number | null;
  lastError: string | undefined;
  pendingPermission: PendingPermissionState | null;
  /** Active AskUserQuestion request, if any. Only one in-flight per session. */
  pendingQuestion: PendingQuestionState | null;
  /** Latest pending plan proposal, if any. */
  pendingPlan: PendingPlanProposal | null;
  /** Generation counter; bumped on respawn so stale callbacks are ignored. */
  generation: number;
  clients: Set<WsClient>;
  drainTimer: NodeJS.Timeout | null;
  /**
   * Session-lifetime resilience state. Driven by `handleSessionFailure`
   * and `attemptRestart`. The web client mirrors this to drive the
   * recovery banner. See `SessionLifecycle` in `chat-protocol/messages.ts`.
   */
  lifecycle: SessionLifecycle;
  /** Auto-respawn counter for the current failure streak (0 when active). */
  recoveryAttempt: number;
  /** Pending setTimeout handle for the next scheduled respawn, if any. */
  recoveryTimer: NodeJS.Timeout | null;
  /**
   * User messages submitted while the SDK loop is dead (lifecycle !=
   * "active") OR drained from a dying inputQueue. Replayed in order
   * into the fresh inputQueue when the bridge respawns the SDK. This
   * is the central piece of the "session survives SDK crash" contract:
   * input that lands during recovery is never dropped.
   */
  pendingInput: SDKUserMessage[];
  /** Latest TodoWrite tasks snapshot, derived from tool_use blocks. */
  latestTasks: Task[] | null;
  /** Current turn id used to group items. Bumped on each user turn. */
  currentTurnId: string;
  /**
   * SDK-level `message.id` captured from the most recent
   * `message_start` event. Set in `onPartial`'s `message_start` branch;
   * read by `resolveAssistantItemId` on every subsequent
   * `content_block_*` event; cleared on `message_stop`. Bridge-internal;
   * never serialised on the wire.
   */
  currentMessageStartId: string | null;
  /**
   * Last SDK-enumerated slash-command catalog (classified per
   * {@link classifySlashCommand}). `null` until the first successful
   * `supportedCommands()` lands. Re-attach uses the non-null value to
   * backfill the joining client without waiting for the next
   * enumeration.
   */
  slashCommands: WireSlashCommand[] | null;
  /**
   * Latches on the first non-error SDK message of a SDK run so the
   * bridge enumerates `supportedCommands()` exactly once per spawn
   * (and once per plugin-install signal). Reset on respawn.
   */
  attachConfirmed: boolean;
  /**
   * Last `getContextUsage()` reading rounded to whole percent. `null`
   * until the first successful poll lands. Cached on the session to
   * dedupe broadcasts: a fresh reading whose percentage delta is < 1
   * AND whose model is unchanged is suppressed.
   */
  contextUsage: ContextUsageSnapshot | null;
}

/** Bridge-internal mirror of {@link ContextUsageUpdateFrame.body}. */
export interface ContextUsageSnapshot {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
  model: string;
}

/**
 * Dense-array filler block used to backfill sparse intermediate
 * slots before a `content_block_start` index write. `_placeholder:
 * true` survives `JSON.stringify` (a normal own property) and is
 * filtered by the web's `AssistantRow.map` before discrimination —
 * the marker is excess metadata on an otherwise legal
 * `AssistantTextBlock`, NOT a new wire variant.
 */
function makePlaceholderBlock(): AssistantBlock {
  return { type: "text", text: "", _placeholder: true };
}

/**
 * Ensure the blocks array is dense up to (but not including)
 * `targetIdx` by pushing placeholder blocks.
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
 * Resolve the stable assistant-item id for a streaming partial.
 * Prefers the SDK-level `message.id`
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

  private config?: ResolvedConfig;
  private resolveSpawnCwdFn: (input: SpawnInput) => Promise<ResolvedSpawnCwd>;
  private startQueryOverride?: (session: ChatSession, mode: "create" | "resume") => void;
  private sdkQueryFactory: (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

  constructor(private store: MetadataStore, opts: BridgeOptions = {}) {
    this.drainMs = opts.drainMs ?? DEFAULT_DRAIN_MS;
    this.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;
    this.config = opts.config;
    this.resolveSpawnCwdFn =
      opts.resolveSpawnCwd ??
      ((input) =>
        defaultResolveSpawnCwd(input, {
          isGitRepo: defaultIsGitRepo,
          createWorktree: defaultCreateWorktree,
        }));
    this.startQueryOverride = opts.startQueryOverride;
    this.sdkQueryFactory = opts.sdkQueryFactory ?? query;
  }

  onTasksUpdate(cb: TasksUpdateListener): () => void {
    this.tasksListeners.add(cb);
    return () => this.tasksListeners.delete(cb);
  }

  getLatestTasks(chatId: string): Task[] | null {
    return this.sessions.get(chatId)?.latestTasks ?? null;
  }

  /** Whether a live bridge session exists for the given chat. */
  hasSession(chatId: string): boolean {
    return this.sessions.has(chatId);
  }

  /** Attach a WS client; lazy-spawn the session if needed. Sends a snapshot. */
  async attach(chatId: string, client: WsClient): Promise<void> {
    let session = this.sessions.get(chatId);
    if (!session) {
      const chat = this.store.chats.get(chatId);
      if (!chat) throw new Error(`chat not found: ${chatId}`);
      session = await this.spawn(chat);
      this.sessions.set(chatId, session);
    }

    if (session.drainTimer) {
      clearTimeout(session.drainTimer);
      session.drainTimer = null;
    }

    session.clients.add(client);
    // Push the chat row so the web client can patch in fields the bridge
    // resolves at spawn time (notably `worktree_path`). Without this,
    // the UI's mount-time `getChat` snapshot stays stale until a route
    // change — the diff panel in particular reads `worktree_path`
    // straight off the chat row.
    const chatRow = this.store.chats.get(session.chatId);
    if (chatRow) {
      this.sendTo(client, {
        kind: "chat-update",
        "chat-id": session.chatId,
        body: { chat: chatRow },
      });
    }
    this.sendTo(client, snapshotFrame(session));
    // Backfill the joining client with the last enumerated catalog
    // so late attachers don't wait for the next SDK re-enumeration.
    // No-op until the first successful `supportedCommands()` lands.
    if (session.slashCommands !== null) {
      this.sendTo(client, {
        kind: "slash-commands-update",
        "chat-id": session.chatId,
        body: { commands: session.slashCommands },
      });
    }
    // Backfill the joining client with the cached usage snapshot
    // first, then trigger a fresh poll so the indicator reflects the
    // latest reading without waiting for the next idle.
    if (session.contextUsage !== null) {
      this.sendTo(client, {
        kind: "context-usage-update",
        "chat-id": session.chatId,
        body: {
          percentage: Math.round(session.contextUsage.percentage),
          totalTokens: session.contextUsage.totalTokens,
          maxTokens: session.contextUsage.maxTokens,
          model: session.contextUsage.model,
        },
      });
    }
    void this.refreshContextUsage(session);
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
   * `submitUserTurnWithPriority(text, "now")` — the default SDK-side
   * priority.
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
      // Echo the original tool input back as `updatedInput`. The SDK's
      // TS type marks it optional, but the claude-code binary's runtime
      // Zod schema rejects an "allow" result that omits it (mirrors
      // t3code's `ClaudeAdapter.ts` permission paths, which always set
      // `updatedInput: toolInput`).
      pending.resolve({
        behavior: "allow",
        updatedInput: pending.pending.input,
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

  private async spawn(chat: ChatRow): Promise<ChatSession> {
    const sessionId = chat.session_id ?? randomUUID();
    if (!chat.session_id) {
      this.store.chats.setSessionId(chat.id, sessionId);
    }

    // Resolve the cwd via the worktree-mode helper before kicking
    // off the SDK query. The helper never throws; a non-null
    // fallbackReason becomes a one-shot system-notice in the timeline.
    const resolved = await this.resolveSpawnCwdFn({
      chat: { id: chat.id, cwd: chat.cwd, worktree_mode: chat.worktree_mode },
      config: { worktreesRoot: this.config?.worktreesRoot ?? null },
    });
    this.store.chats.setWorktreePath(chat.id, resolved.worktreePath);
    if (resolved.fallbackReason) {
      const noticeText = resolved.fallbackDetail ?? `Worktree-mode fallback: ${resolved.fallbackReason}`;
      const notice: SystemNoticeItem = {
        kind: "system-notice",
        id: randomUUID(),
        text: noticeText,
        level: "info",
        createdAt: new Date().toISOString(),
      };
      this.store.chatItems.append(chat.id, notice);
    }

    // Rehydrate the timeline from the durable chat-items log. The
    // Claude SDK has its own server-side memory (the `--resume` path
    // below replays history into the agent), but the UI's view of the
    // conversation lives entirely in `session.items`. Without this
    // replay, every cold attach (drain timeout, server restart, SDK
    // respawn after crash) shows an empty timeline even though the
    // agent remembers everything — that asymmetry is the bug this
    // hydration fixes. See `metadata-store/repos/chat-items.ts`.
    const persistedItems = this.store.chatItems.list(chat.id) as ChatItem[];
    const itemsById = new Map<string, ChatItem>();
    const toolUseToAssistantId = new Map<string, string>();
    for (const item of persistedItems) {
      itemsById.set(item.id, item);
      // Rebuild the tool_use → assistant-id index so that any in-flight
      // tool_result echoes from the SDK on resume can wire back to the
      // correct assistant message. This is the same shape the live
      // path builds in `onAssistantMessage` / `onPartial`.
      if (item.kind === "assistant-message") {
        for (const block of item.blocks) {
          if (block.type === "tool_use") {
            toolUseToAssistantId.set(block.id, item.id);
          }
        }
      }
    }

    const session: ChatSession = {
      chatId: chat.id,
      cwd: resolved.cwd,
      worktreePath: resolved.worktreePath,
      permissionMode: chat.permission_mode,
      sessionId,
      // `inputQueue` and `abortController` are owned by the current SDK
      // run. `startQuery` allocates a fresh pair on each respawn so a
      // dead iterator from a failed run never leaks into the next.
      inputQueue: new UserMessageQueue(),
      abortController: new AbortController(),
      queryHandle: null,
      items: persistedItems,
      itemsById,
      toolUseToAssistantId,
      turnState: "idle",
      turnStartedAtMs: null,
      lastError: undefined,
      pendingPermission: null,
      pendingQuestion: null,
      pendingPlan: null,
      generation: 0,
      clients: new Set(),
      drainTimer: null,
      lifecycle: "active",
      recoveryAttempt: 0,
      recoveryTimer: null,
      pendingInput: [],
      latestTasks: null,
      currentTurnId: randomUUID(),
      currentMessageStartId: null,
      slashCommands: null,
      attachConfirmed: false,
      contextUsage: null,
    };

    // `chat.inert` here means "previously drained / previously crashed
    // and was persisted as inert". Either way the Claude side has the
    // session on disk and the bridge must `resume`. Only a never-spawned
    // chat (inert=false, session_id newly minted) gets the `sessionId:`
    // path so the SDK creates the session row.
    if (this.startQueryOverride) {
      this.startQueryOverride(session, chat.inert ? "resume" : "create");
    } else {
      this.startQuery(session, chat.inert ? "resume" : "create");
    }

    return session;
  }

  /**
   * Allocate SDK `Options`, kick off `query()`, and arm the runLoop
   * error handler. Called once on initial `spawn()` and again on every
   * auto-respawn via `attemptRestart()`. `mode === "resume"` reuses
   * the existing `chat.session_id` (the path used for every respawn
   * after the first ever spawn). `mode === "create"` is only ever
   * passed by the initial spawn of a brand-new chat.
   */
  private startQuery(session: ChatSession, mode: "create" | "resume"): void {
    const sdkOptions: Options = {
      cwd: session.cwd,
      abortController: session.abortController,
      includePartialMessages: true,
      canUseTool: (toolName, input, ctx) =>
        this.handleCanUseTool(session, toolName, input, ctx),
      pathToClaudeCodeExecutable: this.pathToClaudeCodeExecutable,
    };

    const sdkPermissionMode = toSdkPermissionMode(session.permissionMode);
    if (sdkPermissionMode) sdkOptions.permissionMode = sdkPermissionMode;
    if (session.permissionMode === "trusted-vm") {
      sdkOptions.allowDangerouslySkipPermissions = true;
    }

    // Re-read the chat row on every spawn so a mid-flight
    // `model-settings-set` is picked up on the next respawn without
    // disturbing the active Query.
    const settings = this.store.chats.get(session.chatId)?.model_settings ?? null;
    if (settings) {
      if (settings.model) sdkOptions.model = settings.model;
      if (settings.effort) sdkOptions.effort = settings.effort;
      if (settings.thinking) sdkOptions.thinking = settings.thinking;
      if (settings.contextWindow === "1m") sdkOptions.betas = [CONTEXT_1M_BETA];
    }

    if (mode === "resume") {
      sdkOptions.resume = session.sessionId;
    } else {
      sdkOptions.sessionId = session.sessionId;
    }

    const queryHandle = this.sdkQueryFactory({ prompt: session.inputQueue, options: sdkOptions });
    session.queryHandle = queryHandle;

    // PID isn't surfaced by the SDK; the older bridge stored it for
    // the sidebar's running-state badge. We mark active here and clear
    // it on disposal. On respawn this also flips the persisted `inert`
    // flag back so the chat row reflects "session is live again".
    this.store.chats.markActive(session.chatId);

    // Drive the SDK loop in the background. Any throws are routed to
    // `handleSessionFailure`, which preserves the ChatSession + queued
    // input and schedules an auto-respawn (see `RECOVERY_BACKOFF_MS`).
    //
    // The handle-identity guard (`session.queryHandle !== queryHandle`)
    // discards stale catches: if a respawn already replaced the handle
    // before this catch landed, the failure belongs to a prior run and
    // has already been processed.
    this.runLoop(session, queryHandle).catch((err) => {
      if (session.queryHandle !== queryHandle) return;
      this.handleSessionFailure(session, err);
    });
  }

  private async runLoop(session: ChatSession, q: Query): Promise<void> {
    for await (const msg of q) {
      this.handleSdkMessage(session, msg);
    }
    // Iterator ended cleanly — clean shutdown (drain timer closed the
    // queue, or `disposeSession` aborted). Mark the chat row inert so
    // the next attach uses `resume:`. We do NOT touch `lifecycle` here:
    // recovery-state transitions are owned by `attemptRestart` /
    // `handleSessionFailure` so a normal shutdown can't accidentally
    // mask an in-flight failure mode.
    this.store.chats.markInert(session.chatId);
  }

  /**
   * The single entry point for SDK loop failures. Replaces the previous
   * "mark inert + leave a stale ChatSession in the map" path that
   * silently dropped subsequent user input. t3code's resilience
   * pattern adapted to loom: keep the session in memory, preserve any
   * unflushed user input, and schedule a respawn with `resume:`.
   *
   * Steps:
   *   1. Stamp `lastError`, flip `turnState` to `"error"`, append a
   *      single error system-notice to the timeline (audit trail).
   *   2. Mark any in-flight assistant message non-streaming so the web
   *      timeline doesn't leave a perpetual blinking caret.
   *   3. Drain the dying inputQueue into `pendingInput` and close it
   *      so the dead iterator can't accept new pushes. New writes
   *      land in `pendingInput` via `submitUserTurnWithPriority`'s
   *      lifecycle-gated branch.
   *   4. Mark the chat row inert so a server restart picks up via
   *      `resume:` (DB-persisted recovery contract).
   *   5. Hand off to `scheduleRecovery` which arms the next respawn.
   */
  private handleSessionFailure(session: ChatSession, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    session.lastError = message;
    this.setTurnState(session, "error");
    this.appendItem(session, makeNotice(`Session error: ${message}`, "error"));

    // Roll any still-streaming assistant message to a non-streaming
    // state so the UI's caret stops blinking. The SDK never sent the
    // matching `message_stop`, so we synthesize the closure here.
    for (const item of session.items) {
      if (item.kind === "assistant-message" && item.streaming) {
        item.streaming = false;
        item.updatedAt = new Date().toISOString();
        this.updateItem(session, item);
      }
    }

    // Capture unflushed user input. `inputQueue` is the dead SDK
    // iterator's source: any messages we pushed but the SDK never
    // consumed are still in there. Replay them into the new queue on
    // respawn so the user's turn isn't lost.
    const carried = session.inputQueue.drain();
    if (carried.length > 0) {
      session.pendingInput.push(...carried);
    }
    try { session.inputQueue.close(); } catch {}
    session.queryHandle = null;

    // Persist the inert flag so a server restart mid-recovery still
    // picks up via `resume:`. The in-memory session continues to
    // exist (we don't `disposeSession`) — that's the central invariant.
    this.store.chats.markInert(session.chatId);

    this.scheduleRecovery(session);
  }

  /**
   * Arm the next auto-respawn attempt with exponential backoff per
   * `RECOVERY_BACKOFF_MS`. When the schedule is exhausted, transition
   * to `lifecycle: "failed"` and wait for the client's explicit
   * `retry-session` frame.
   *
   * The recovery counter (`session.recoveryAttempt`) increments here
   * (not in `handleSessionFailure`) so that a manual retry via
   * `retrySession()` can reset the counter and replay from attempt 1.
   */
  private scheduleRecovery(session: ChatSession): void {
    if (session.recoveryTimer) {
      clearTimeout(session.recoveryTimer);
      session.recoveryTimer = null;
    }

    const nextAttempt = session.recoveryAttempt + 1;
    if (nextAttempt > RECOVERY_BACKOFF_MS.length) {
      // Auto-recovery exhausted — give up and let the user decide.
      this.setLifecycle(session, "failed");
      this.appendItem(
        session,
        makeNotice(
          `Auto-recovery exhausted after ${RECOVERY_BACKOFF_MS.length} attempts. Press Retry to try again.`,
          "error",
        ),
      );
      return;
    }

    session.recoveryAttempt = nextAttempt;
    this.setLifecycle(session, "recovering");

    const delay = RECOVERY_BACKOFF_MS[nextAttempt - 1] ?? RECOVERY_BACKOFF_MS[RECOVERY_BACKOFF_MS.length - 1]!;
    session.recoveryTimer = setTimeout(() => {
      session.recoveryTimer = null;
      this.attemptRestart(session);
    }, delay);
  }

  /**
   * Build a fresh SDK input queue + AbortController on the session,
   * replay any buffered user input, and call `startQuery` in `resume`
   * mode. Called by the recovery timer (`scheduleRecovery`) and by
   * the user-initiated `retrySession` path.
   *
   * On synchronous setup success the session optimistically flips to
   * `lifecycle: "active"` — the SDK loop is now driving messages.
   * If the new run fails (synchronously or asynchronously), the
   * runLoop catch routes back to `handleSessionFailure`, which will
   * call `scheduleRecovery` again. Repeated failures hit the same
   * backoff schedule until the attempt counter exhausts.
   */
  private attemptRestart(session: ChatSession): void {
    session.inputQueue = new UserMessageQueue();
    session.abortController = new AbortController();
    session.currentMessageStartId = null;
    // Re-arm enumeration on respawn: the next non-error SDK message
    // confirms the fresh attach and re-fires `supportedCommands()`.
    session.attachConfirmed = false;
    // Replay buffered input into the fresh queue. Preserves FIFO order.
    const replay = session.pendingInput;
    session.pendingInput = [];
    for (const msg of replay) {
      session.inputQueue.push(msg);
    }

    try {
      this.startQuery(session, "resume");
    } catch (err) {
      // `query()` itself threw synchronously (very rare). Treat as a
      // fresh failure — handleSessionFailure will schedule the next
      // attempt with bumped `recoveryAttempt`.
      this.handleSessionFailure(session, err);
      return;
    }

    // Optimistic flip. If the SDK throws on first iteration, the
    // runLoop catch will move us back to "recovering" or "failed".
    this.setLifecycle(session, "active");
  }

  /**
   * Public manual-recovery entry point bound to the `retry-session`
   * client frame. No-op when the session is already running or in
   * the middle of an auto-recovery attempt — both states will reach
   * the terminal active/failed transition on their own. Resets the
   * auto-retry counter so the manual press gets a full backoff
   * schedule before giving up again.
   */
  retrySession(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    if (session.lifecycle !== "failed") return;
    if (session.recoveryTimer) {
      clearTimeout(session.recoveryTimer);
      session.recoveryTimer = null;
    }
    session.recoveryAttempt = 0;
    session.lastError = undefined;
    this.attemptRestart(session);
  }

  /**
   * Broadcast a `session-state` frame iff the lifecycle is actually
   * changing (or `recoveryAttempt` moved). Updates the in-memory
   * session bookkeeping first so subsequent reads (e.g. snapshot on
   * a new attach) reflect the new state.
   */
  private setLifecycle(session: ChatSession, lifecycle: SessionLifecycle): void {
    const prev = session.lifecycle;
    session.lifecycle = lifecycle;
    if (prev === lifecycle) return;
    this.broadcast(session, {
      kind: "session-state",
      "chat-id": session.chatId,
      body: {
        lifecycle,
        recoveryAttempt: session.recoveryAttempt,
        lastError: session.lastError,
      },
    });
  }

  private handleSdkMessage(session: ChatSession, msg: SDKMessage): void {
    // The first non-error SDK message of a spawn confirms attach
    // and triggers the initial `supportedCommands()` enumeration. A
    // `plugin_install` completion re-fires enumeration so newly
    // installed skills surface without a re-attach.
    const isErrorResult = msg.type === "result" && (msg as { is_error?: boolean }).is_error === true;
    const isPluginReload =
      msg.type === "system" &&
      (msg as { subtype?: string }).subtype === "plugin_install" &&
      ((msg as { status?: string }).status === "completed" ||
        (msg as { status?: string }).status === "installed");
    if (!isErrorResult && !session.attachConfirmed) {
      session.attachConfirmed = true;
      void this.refreshSlashCommands(session);
    } else if (isPluginReload) {
      void this.refreshSlashCommands(session);
    }

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

  /**
   * Call `query.supportedCommands()`, classify each row via
   * {@link classifySlashCommand}, store the catalog on the session,
   * and broadcast a `slash-commands-update` frame. Generation-guarded
   * so a late-resolving enumeration from a stale `Query`
   * (post-respawn) is discarded. On throw: leave
   * `session.slashCommands` at its prior value and emit no frame.
   */
  private async refreshSlashCommands(session: ChatSession): Promise<void> {
    const queryHandle = session.queryHandle;
    if (!queryHandle) return;
    let rows: SlashCommand[];
    try {
      rows = await queryHandle.supportedCommands();
    } catch {
      return;
    }
    if (session.queryHandle !== queryHandle) return;
    const commands: WireSlashCommand[] = rows.map((row) => ({
      name: row.name,
      description: row.description,
      argumentHint: row.argumentHint,
      kind: classifySlashCommand(row),
    }));
    session.slashCommands = commands;
    this.broadcast(session, {
      kind: "slash-commands-update",
      "chat-id": session.chatId,
      body: { commands },
    });
  }

  /**
   * Poll `query.getContextUsage()`, round percentage to integer, and
   * broadcast a `context-usage-update` frame unless the reading is
   * suppressed (|Δpercentage| < 1 AND same model). Generation-guarded
   * so a late resolution from a stale `Query` post-respawn is
   * dropped. On throw: leave the cached snapshot untouched and emit
   * no frame.
   */
  private async refreshContextUsage(session: ChatSession): Promise<void> {
    const queryHandle = session.queryHandle;
    if (!queryHandle) return;
    let reading: SDKControlGetContextUsageResponse;
    try {
      reading = await queryHandle.getContextUsage();
    } catch {
      return;
    }
    if (session.queryHandle !== queryHandle) return;
    // Internal mirror keeps raw percentage so the suppression rule (raw
    // delta < 1) survives the rounding applied for the wire payload.
    const next: ContextUsageSnapshot = {
      percentage: reading.percentage,
      totalTokens: reading.totalTokens,
      maxTokens: reading.maxTokens,
      model: reading.model,
    };
    const prev = session.contextUsage;
    if (
      prev !== null &&
      Math.abs(next.percentage - prev.percentage) < 1 &&
      next.model === prev.model
    ) {
      return;
    }
    session.contextUsage = next;
    this.broadcast(session, {
      kind: "context-usage-update",
      "chat-id": session.chatId,
      body: {
        percentage: Math.round(next.percentage),
        totalTokens: next.totalTokens,
        maxTokens: next.maxTokens,
        model: next.model,
      },
    });
  }

  /** Materialise an assistant message (post-stream finalised content). */
  private onAssistant(session: ChatSession, msg: SDKAssistantMessage): void {
    // Key by `msg.message.id` so the streaming row (created by
    // `onPartial` under the same id) coalesces with the canonical
    // final-assistant row. `msg.uuid` is the SDK-event UUID and is
    // NOT the same string as `msg.message.id`. Without this paired
    // migration the final-message path would `appendItem` a new row
    // and break the invariant of "never more than one
    // assistant-message row per `message.id`".
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
    // Collect ExitPlanMode tool_use blocks for post-pass dispatch.
    // The parent assistant message is appended first (audit trail),
    // then one `plan-proposed` item is emitted per ExitPlanMode
    // block found.
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

    // Emit a `plan-proposed` item for each ExitPlanMode tool_use
    // observed on this assistant message. Empty plan body → append
    // a `system-notice` and skip the plan-proposed item.
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

    // Capture `event.message.id` BEFORE any item lookup so
    // subsequent content_block_* branches use the stable id.
    // `message_start` is the first event for any logical Claude
    // message per the SDK's typed event union
    // (BetaRawMessageStartEvent precedes any content block). No item
    // is created on this branch — the next content_block_start does
    // the create-or-update work.
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
      // Backfill sparse intermediate slots BEFORE the index write
      // so the array stays dense end-to-end and survives
      // `JSON.stringify` without holes becoming literal `null`s.
      // No-op when `idx <= aitem.blocks.length`.
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
        // Unknown block type — leave the placeholder at `idx`
        // rather than overwriting with `undefined` (which would
        // re-introduce a sparse hole). The web's AssistantRow
        // filters placeholders before discrimination, so the
        // unknown slot renders as nothing.
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
      // Clear the per-message scratch so the NEXT SDK message
      // within the same user turn (multi-tool case) starts a fresh
      // `message_start → currentMessageStartId` chain.
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
    // AskUserQuestion is permission-gated by the SDK, but the UI
    // surface is a dedicated picker (not the generic permission
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
   * Parse an AskUserQuestion tool input into a `PendingQuestion`,
   * broadcast a `pending-question` frame, and stash
   * the SDK's `resolve` closure so `respondToQuestion` can drive it
   * when the user submits the picker.
   *
   * The SDK's AskUserQuestion input shape (Claude Agent SDK ≥ 0.2):
   *   {
   *     questions: [{
   *       question: string,
   *       header: string,
   *       options: [{ label: string, description: string, preview?: string }],
   *       multiSelect?: boolean,
   *     }],
   *   }
   * Options have no `id` — we synthesize one from the label so the
   * picker has a stable React key and so the answers map can be
   * rebuilt on submit. The bridge parses defensively — non-conforming
   * inputs render a "no options provided" state without throwing.
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
      const questionsArr = Array.isArray(input.questions) ? input.questions : [];
      const first = (questionsArr[0] ?? {}) as Record<string, unknown>;
      const question = typeof first.question === "string" ? first.question : "";
      const optionLabels: Record<string, string> = {};
      const options = Array.isArray(first.options)
        ? (first.options as unknown[]).flatMap((o, idx) => {
            const r = o as { label?: unknown; description?: unknown };
            if (typeof r.label !== "string") return [];
            const optId = `opt-${idx}-${r.label}`;
            optionLabels[optId] = r.label;
            const opt: { id: string; label: string; description?: string } = {
              id: optId,
              label: r.label,
            };
            if (typeof r.description === "string") opt.description = r.description;
            return [opt];
          })
        : [];
      const multiSelect = first.multiSelect === true;
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
        originalInput: input,
        questionText: question,
        optionLabels,
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
    // Mirror into the durable log so a cold attach (drain timeout,
    // server restart, SDK respawn) rebuilds the same timeline. We
    // persist before broadcasting so a crash between the two flushes
    // through the log on next start rather than only on the wire.
    this.persistAppend(session.chatId, item);
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
    this.persistUpdate(session.chatId, item);
    this.broadcast(session, {
      kind: "item-update",
      "chat-id": session.chatId,
      body: { item },
    });
  }

  private persistAppend(chatId: string, item: ChatItem): void {
    // Defensive try/catch: persistence is best-effort. The in-memory
    // session is still authoritative for live broadcasts; if the log
    // write throws (disk full, permission flap), we don't want to
    // wedge the chat — the snapshot path will recover whatever made
    // it to disk on next attach.
    try {
      this.store.chatItems.append(chatId, item);
    } catch (err) {
      console.warn(
        `[claude-session-bridge] failed to persist append for chat=${chatId} item=${item.id}: ${(err as Error).message}`,
      );
    }
  }

  private persistUpdate(chatId: string, item: ChatItem): void {
    try {
      this.store.chatItems.update(chatId, item);
    } catch (err) {
      console.warn(
        `[claude-session-bridge] failed to persist update for chat=${chatId} item=${item.id}: ${(err as Error).message}`,
      );
    }
  }

  private setTurnState(session: ChatSession, state: TurnState): void {
    if (session.turnState === state) return;
    // Transitioning out of "error" into a healthy state (recovery
    // succeeded — running or idle) means the prior `lastError` is
    // stale. Clearing it here prevents the bridge from re-echoing the
    // dead error on every subsequent turn-state broadcast / snapshot,
    // which the web reducer would otherwise treat as fresh and
    // potentially re-raise after a WS reconnect / chat-switch reset.
    if (session.turnState === "error" && (state === "running" || state === "idle")) {
      session.lastError = undefined;
    }
    session.turnState = state;
    // Manage the turn-start epoch so reconnecting clients can keep the
    // working-timer counting from the original start (not Date.now() at
    // snapshot time). Only stamp/clear on real edges — the early-return
    // above already guards running→running no-ops.
    if (state === "running") {
      session.turnStartedAtMs = Date.now();
    } else {
      session.turnStartedAtMs = null;
    }
    this.broadcast(session, {
      kind: "turn-state",
      "chat-id": session.chatId,
      body: { state, lastError: session.lastError },
    });
    // Repoll the SDK's context-window breakdown on every transition
    // into idle (turn completed). The bridge does NOT free-run-poll
    // between turns — mid-turn percentages are noisy and not
    // actionable.
    if (state === "idle") {
      void this.refreshContextUsage(session);
    }
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
    if (session.recoveryTimer) {
      clearTimeout(session.recoveryTimer);
      session.recoveryTimer = null;
    }
    try { session.abortController.abort(); } catch {}
    try { session.inputQueue.close(); } catch {}
    this.sessions.delete(session.chatId);
    if (opts.markInert) {
      this.store.chats.markInert(session.chatId);
    }
  }

  /**
   * Push a permission-mode change through to the live SDK Query
   * handle so the SDK's tool-gate behaviour switches immediately.
   * Calls are NOT debounced or coalesced; each invocation is
   * forwarded to the SDK in-order. No-op when the chat has no live
   * session (the next attach will spawn with whatever
   * `permission_mode` the chat row holds).
   */
  async setPermissionMode(chatId: string, mode: WirePermissionMode): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const queryHandle = session.queryHandle;
    if (!queryHandle) return;
    try {
      await queryHandle.setPermissionMode(mode as SdkPermissionMode);
    } catch (err) {
      // Surface the failure as a session-scoped notice. A user-turn
      // already queued is NOT rolled back — the user explicitly
      // asked for both.
      const message = err instanceof Error ? err.message : String(err);
      this.appendItem(session, makeNotice(`Permission mode change failed: ${message}`, "error"));
    }
  }

  /**
   * Merge a partial {@link WireModelSettings} patch into the
   * chat-row JSON and broadcast a `chat-update` frame so attached
   * clients re-derive pill labels. The active `Query` is NOT
   * interrupted or respawned — the change lands on the next
   * `startQuery()` via the chat-row read at spawn time.
   *
   * Validation:
   *   - Unknown keys are silently dropped (no error).
   *   - Invalid `effort` / `contextWindow` / `thinking` shapes yield
   *     an `error` frame, NO persistence.
   */
  setModelSettings(chatId: string, patch: Partial<WireModelSettings>): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const cleaned: Partial<WireModelSettings> = {};
    if ("model" in patch) {
      const value = patch.model;
      if (value !== null && typeof value !== "string") {
        this.emitSettingsError(session, "model-settings-set: invalid model");
        return;
      }
      cleaned.model = value;
    }
    if ("effort" in patch) {
      const value = patch.effort;
      if (
        value !== null &&
        value !== "low" &&
        value !== "medium" &&
        value !== "high" &&
        value !== "xhigh" &&
        value !== "max"
      ) {
        this.emitSettingsError(session, "model-settings-set: invalid effort");
        return;
      }
      cleaned.effort = value;
    }
    if ("thinking" in patch) {
      const value = patch.thinking;
      if (
        value !== null &&
        (typeof value !== "object" ||
          (value as { type?: unknown }).type !== "enabled" ||
          typeof (value as { budgetTokens?: unknown }).budgetTokens !== "number")
      ) {
        this.emitSettingsError(session, "model-settings-set: invalid thinking");
        return;
      }
      cleaned.thinking = value;
    }
    if ("contextWindow" in patch) {
      const value = patch.contextWindow;
      if (value !== null && value !== "200k" && value !== "1m") {
        this.emitSettingsError(session, "model-settings-set: invalid contextWindow");
        return;
      }
      cleaned.contextWindow = value;
    }
    if (Object.keys(cleaned).length === 0) return;
    this.store.chats.update(chatId, { model_settings: cleaned });
    const row = this.store.chats.get(chatId);
    if (!row) return;
    this.broadcast(session, {
      kind: "chat-update",
      "chat-id": chatId,
      body: { chat: row },
    });
  }

  private emitSettingsError(session: ChatSession, message: string): void {
    this.broadcast(session, {
      kind: "error",
      "chat-id": session.chatId,
      body: { message },
    });
  }

  /**
   * Submit a user-turn with an explicit SDK priority field. The
   * priority is set on the `SDKUserMessage` pushed onto the input
   * queue; the SDK-side scheduler does the actual prioritisation
   * (the bridge's queue stays FIFO).
   */
  submitUserTurnWithPriority(
    chatId: string,
    text: string,
    priority: "now" | "next" | "later",
    images?: ReadonlyArray<UserTurnImage>,
  ): void {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const trimmed = text.trim();
    const hasImages = images != null && images.length > 0;
    // Relax the blank-input guard so an images-only-no-text turn
    // is still legitimate. Empty text + empty/undefined images
    // stays rejected.
    if (!trimmed && !hasImages) return;

    session.currentTurnId = randomUUID();
    // Reset the per-message scratch id at every turn boundary. A
    // new `message_start` populates it for the first SDK message of
    // the new turn.
    session.currentMessageStartId = null;
    const item: UserMessageItem = {
      kind: "user-message",
      id: randomUUID(),
      turnId: session.currentTurnId,
      text: trimmed,
      createdAt: new Date().toISOString(),
      // Stamp images onto the appended UserMessageItem so
      // {@link MessagesTimeline}'s `UserRow` can render thumbnails.
      ...(hasImages ? { images: images.map((img) => ({ ...img })) } : {}),
    };
    this.appendItem(session, item);

    // Build SDK message content. The SDK's
    // `MessageParam['content']` is `string | ContentBlockParam[]`;
    // build the array shape when there are images and the plain
    // string shape otherwise. Both shapes are first-class for the
    // SDK — two type-correct constructions, no fallback branching.
    //
    // Indexed access through `SDKUserMessage` keeps the bridge typed
    // against the live SDK contract without pulling `@anthropic-ai/sdk`
    // in as a direct dependency.
    type SdkContent = SDKUserMessage["message"]["content"];
    type SdkBlock = Extract<SdkContent, readonly unknown[]>[number];
    type SdkTextBlock = Extract<SdkBlock, { type: "text" }>;
    type SdkImageBlock = Extract<SdkBlock, { type: "image" }>;
    type SdkBase64Source = Extract<SdkImageBlock["source"], { type: "base64" }>;
    type SdkImageMediaType = SdkBase64Source["media_type"];

    const sdkContent: SdkContent = hasImages
      ? [
          ...(trimmed ? [{ type: "text", text: trimmed } satisfies SdkTextBlock] : []),
          ...images.map(
            (img): SdkImageBlock => ({
              type: "image",
              source: {
                type: "base64",
                // The `mediaType` field on the wire-protocol `UserTurnImage`
                // is intentionally typed `string` to keep the wire schema
                // permissive; the runtime trust boundary is the
                // `sanitizeUserTurnImages` filter in `http-ws-server.ts`
                // The SDK only accepts a narrow union here, so the
                // value is asserted at this boundary — invalid MIMEs
                // are rejected by the SDK downstream rather than the
                // bridge silently emitting an `unknown`.
                media_type: img.mediaType as SdkImageMediaType,
                data: img.dataB64,
              },
            }),
          ),
        ]
      : trimmed;
    const sdkMessage: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: sdkContent },
      parent_tool_use_id: null,
      session_id: session.sessionId,
      priority,
    };

    // Lifecycle-gated dispatch. While the SDK loop is dead (recovering
    // or failed), pushing to `inputQueue` would either no-op (closed
    // queue) or hand the message to an iterator nobody is consuming.
    // Buffer into `pendingInput` instead — `attemptRestart` replays
    // these into the fresh queue on respawn. This is the contract
    // that turns "session error" from "chat is dead, recreate it"
    // into "your message is buffered and will land when we recover".
    if (session.lifecycle !== "active" || session.queryHandle === null) {
      session.pendingInput.push(sdkMessage);
      // If we'd previously given up, this user gesture is implicit
      // consent to try again — kick the manual-retry path so the
      // buffered turn doesn't sit forever.
      if (session.lifecycle === "failed") {
        this.retrySession(chatId);
      }
      // We intentionally do NOT setTurnState("running") here: the SDK
      // isn't actually running. The web composer reads `lifecycle` to
      // render a "Queued — reconnecting" hint instead.
      return;
    }

    this.setTurnState(session, "running");
    session.inputQueue.push(sdkMessage);
  }

  /**
   * Accept the latest pending plan proposal.
   *
   * Side-effect chain:
   *   1. `Query.setPermissionMode("default")` on the live SDK Query
   *      handle — permission gate reverts so the next user-turn
   *      executes tools without the plan-mode lockout.
   *   2. Queue a "Please execute the plan as proposed" user-turn via
   *      the existing `submitUserTurnWithPriority(text, "now")` path.
   *   3. Flip the plan-proposed item's `status` to `"accepted"` and
   *      broadcast an `item-update` so attached clients re-render
   *      the card with greyed-out controls.
   *
   * The `setPermissionMode` call is NOT debounced and is NOT
   * coalesced with composer-footer selector changes. No composer
   * draft is auto-submitted on Accept — only the canonical execute
   * user-turn is queued. Defensive guards drop the call when no
   * matching pending plan exists in the session.
   */
  async acceptPlanProposal(chatId: string, planId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const item = session.itemsById.get(planId);
    if (!item || item.kind !== "plan-proposed") return;
    if (item.status !== "pending") return;

    // 1. Flip permission mode back to default. Errors surface as a
    //    session-scoped system-notice via the existing wrapper; the
    //    queued user-turn is NOT rolled back.
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
   * Reject the latest pending plan proposal.
   *
   * Queues a "Please reconsider the plan; do not execute it as-is"
   * user-turn via `submitUserTurnWithPriority(text, "now")` and
   * flips the item's status to `"rejected"`. Permission mode is
   * left unchanged — the SDK remains in `"plan"`.
   */
  async rejectPlanProposal(chatId: string, planId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;
    const item = session.itemsById.get(planId);
    if (!item || item.kind !== "plan-proposed") return;
    if (item.status !== "pending") return;

    // Queue the reconsider user-turn. Permission mode is left
    // unchanged — the SDK stays in "plan" so Claude knows to issue
    // a revised plan rather than start executing.
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
   * Emit a `plan-proposed` ChatItem in response to an observed
   * `ExitPlanMode` tool_use. Sets `session.pendingPlan` so the
   * matching Accept/Reject frame can find the item by id without
   * re-parsing the tool_use block.
   *
   * Empty / non-string plan bodies append a `system-notice` and
   * skip the plan-proposed item.
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
   * Resolve a pending AskUserQuestion request.
   *
   * AskUserQuestion is permission-gated by the SDK; the bridge
   * replies with `behavior: "allow"` and packs the user's selected
   * answers into `updatedInput` so the SDK forwards them back to
   * Claude as the tool's effective input.
   *
   * Stale / mismatched ids are dropped silently (slow-client
   * guard); the matching `pending-question {body: null}` clearing
   * frame is emitted on the happy path when the question is
   * consumed.
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
    // SDK reads `updatedInput` as the AskUserQuestion tool result and
    // expects shape `{ questions, answers: { [questionText]: string } }`
    // — multi-select answers join with commas. The freeform sentinel
    // `__freeform__` is replaced with the typed text; if it's the only
    // answer, the typed text stands alone.
    const FREEFORM = "__freeform__";
    const mapped = answer.answers.map((aid) => {
      if (aid === FREEFORM) return answer.otherText ?? "";
      return pending.optionLabels[aid] ?? aid;
    }).filter((s) => s.length > 0);
    const answerString = mapped.join(", ");
    const updatedInput: Record<string, unknown> = {
      questions: (pending.originalInput.questions as unknown) ?? [],
      answers: { [pending.questionText]: answerString },
    };

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
   * Synthetic entry point used by the AskUserQuestion test suite
   * to exercise `handleCanUseTool` without spinning up a real SDK
   * session. Mirrors the SDK's `canUseTool` callback signature.
   *
   * Returns the same promise the SDK would await; tests can resolve
   * it by invoking `respondToQuestion` and observe the broadcast
   * side effects.
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
   * Synthetic entry point used by the `bridge-image-flatten.test.ts`
   * suite to push a hand-crafted SDKMessage through the bridge's
   * dispatch path (`handleSdkMessage`) without driving the real SDK.
   * Exposes private routing for unit tests; production code paths
   * go through `runLoop` instead.
   */
  __test__handleSdkMessage(chatId: string, msg: unknown): void {
    const session = this.sessions.get(chatId);
    if (!session) {
      throw new Error(`__test__handleSdkMessage: no session for ${chatId}`);
    }
    this.handleSdkMessage(session, msg as SDKMessage);
  }

  /**
   * Synthetic entry point for the recovery test suite. Drives the
   * `handleSessionFailure` path without needing a real SDK crash —
   * lets unit tests exercise pendingInput buffering, the
   * lifecycle:"failed" terminal state, and `retrySession`'s lazy
   * restart. Production code reaches this only via the runLoop catch.
   */
  __test__triggerFailure(chatId: string, message: string): void {
    const session = this.sessions.get(chatId);
    if (!session) {
      throw new Error(`__test__triggerFailure: no session for ${chatId}`);
    }
    this.handleSessionFailure(session, new Error(message));
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
      turnStartedAtMs: null,
      lastError: undefined,
      pendingPermission: null,
      pendingQuestion: null,
      pendingPlan: null,
      generation: 0,
      clients: new Set(),
      drainTimer: null,
      lifecycle: "active",
      recoveryAttempt: 0,
      recoveryTimer: null,
      pendingInput: [],
      latestTasks: null,
      currentTurnId: randomUUID(),
      currentMessageStartId: null,
      slashCommands: null,
      attachConfirmed: false,
      contextUsage: null,
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
    lifecycle: session.lifecycle,
    recoveryAttempt: session.recoveryAttempt,
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
