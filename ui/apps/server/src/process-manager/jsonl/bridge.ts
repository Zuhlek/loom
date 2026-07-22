/**
 * jsonl/bridge.ts — JsonlTailBridge.
 *
 * One bridge per server process. Holds per-chat
 * `ChatState`. The factory returns the public surface consumed by
 * `http-ws-server.ts` and the routes.
 *
 * Composition:
 *   - tmux: `TmuxSessionApi` — only path to the `claude` PTY.
 *   - sessionStore: `SessionIdStore` — chatId → sessionId persistence.
 *   - tailRoot: directory claude writes transcripts under
 *     (`~/.claude/projects` in production; a tmpdir in tests).
 *   - tail: `JsonlTail` (per chat) — append-only line reader.
 *   - materializer: `Materializer` (per chat) — ClaudeEvent → ChatItem[].
 *
 * No drain timer. No idle reaper. Detach is a pure WS removal — the
 * `claude` process keeps running until `dispose(chatId)` is called
 * (chat delete) or the user explicitly kills the chat through retry.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { createJsonlTail, type JsonlTail } from "./tail.ts";
import { createMaterializer, type Materializer } from "./materializer.ts";
import {
  StageImageError,
  type ImageStore,
} from "./image-store.ts";
import type { UserTurnImage } from "../../chat-protocol/frames.ts";
import { translate, type TranslatorCtx } from "./translator.ts";
import { discoverActiveJsonl } from "./discover-active-jsonl.ts";
import { createBridgeLog, type BridgeLog } from "./bridge-log.ts";
import type { TmuxSessionApi } from "../tmux-session.ts";
import { TmuxUnavailableError } from "../tmux-availability.ts";
import type { SessionIdStore } from "../session-store.ts";
import type { PaneProcessApi } from "../pane-process.ts";
import { traceHook } from "../../hook-receiver/trace.ts";
import type { PermissionGate } from "../../hook-receiver/permission-gate.ts";
import type {
  ChatItem,
  PendingPermission,
  PendingQuestion,
  Task,
  WireModelSettings,
  WireSlashCommand,
} from "../../chat-protocol/messages.ts";
import {
  discoverUserSlashCommands,
  mergeSlashCommands,
} from "./user-commands.ts";
import type { WirePermissionMode } from "../../chat-protocol/frames.ts";
import {
  serializeServerFrame,
  type ServerFrame,
  type SnapshotFrame,
} from "../../chat-protocol/frames.ts";
import type { ChatEnvelope } from "../../chat-protocol/envelope.ts";
import type { ChatRow } from "../../metadata-store/repos/chat.ts";

export interface WsClient {
  send(text: string): void;
}

export type TasksUpdateListener = (chatId: string, tasks: Task[]) => void;

/**
 * Encode a cwd the way claude names its per-project transcript
 * directory: path separators AND whitespace runs collapse to a single
 * `-` (`/Volumes/My Shared Files/repo` → `-Volumes-My-Shared-Files-repo`).
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[\s/]+/g, "-");
}

export interface JsonlTailBridgeOptions {
  tmux: TmuxSessionApi;
  sessionStore: SessionIdStore;
  /** Transcript root, `~/.claude/projects` in production. */
  tailRoot: string;
  /**
   * File-ownership identity check for the rotation poller. The bridge
   * adopts a candidate JSONL only when `paneProcess.paneOwnsFile`
   * confirms the writer descends from this chat's tmux pane PID — the
   * authoritative gate against bystander claude sessions writing in
   * the same encoded-cwd directory.
   */
  paneProcess: PaneProcessApi;
  /**
   * Permission gate shared with the hook receiver. `respondToPermission`
   * resolves the gate registered by a held PreToolUse hook, which is what
   * actually unblocks the agent — there is no keystroke injection for
   * permissions any more. When omitted, permission responses degrade to a
   * UI-only acknowledgement (the held curl, if any, auto-resolves on timeout).
   */
  permissionGate?: PermissionGate;
  /** Resolve the cwd to spawn `claude` under for a given chat. */
  cwdResolver(chatId: string): Promise<string> | string;
  /**
   * Resolve the chat's persisted permission mode for spawn-time CLI
   * flag selection. Returning `"default"` (or omitting the resolver
   * entirely) keeps claude in its built-in supervised mode.
   * `bypassPermissions` ⇒ `--dangerously-skip-permissions`;
   * `plan` / `acceptEdits` ⇒ `--permission-mode <m>`.
   */
  permissionModeResolver?(
    chatId: string,
  ): Promise<WirePermissionMode> | WirePermissionMode;
  /**
   * Persist a composer-driven mode change to the chat row. Called from
   * `setPermissionMode` before the keystroke fan-out so the row is the
   * authoritative source of truth even if the in-pane cycle fails.
   * Returning the updated row lets the bridge fan it out as a
   * `chat-update` frame for instant sidebar refresh.
   */
  persistPermissionMode?(
    chatId: string,
    mode: WirePermissionMode,
  ): Promise<unknown> | unknown;
  /** Tail polling interval — small in tests, default 250ms in production. */
  tailPollingMs?: number;
  /**
   * Rotation-discovery interval. The bridge re-runs directory-scan on
   * this cadence to detect claude rotating its session-id mid-
   * conversation. Default 500ms; smaller values shorten the rotation-
   * detection latency at the cost of more `readdir` calls.
   */
  rotationPollMs?: number;
  /**
   * Cold-start readiness fallback (F1). Millis after a fresh spawn at
   * which the chat is force-marked ready and its queued turns flush, in
   * case claude's `SessionStart` hook never arrives. Defaults to
   * {@link READY_FALLBACK_MS} (10s). Tests inject a small value to drive
   * the fallback path deterministically.
   */
  readyFallbackMs?: number;
  /**
   * Structured per-stage log. When omitted, a default log is created
   * from `process.env.LOOM_LOG_BRIDGE` so production deployments get
   * info-level visibility into attach / detach / first-emit. Tests
   * inject a sink recorder.
   */
  log?: BridgeLog;
  /**
   * Lifecycle hooks for chat-diff-panel substrate wiring.
   *  - `onChatAttach` runs once per `attach()` call. Used by
   *    `reconcileGitContextOnAttach` and `turnWatcher.start`.
   *  - `onFirstUserTurn` runs before the first `submitUserTurn`
   *    for a chat. Used by `runFirstSendHook`. The bridge awaits the
   *    returned promise before forwarding the turn input.
   *  - `onAssistantTurnComplete` runs after the bridge's materializer
   *    has emitted a turn-state idle frame for an assistant terminus.
   *    Used by `createCheckpointReactor.captureTurn` (via TurnWatcher).
   */
  onChatAttach?(chatId: string, cwd: string): void;
  onFirstUserTurn?(chatId: string): Promise<void> | void;
  onAssistantTurnComplete?(chatId: string, cwd: string): void;
  /**
   * Pre-spawn folder-trust seeding. Called with the resolved cwd right
   * before a `bypassPermissions` spawn so claude's
   * `--dangerously-skip-permissions` trust dialog never blocks the pane
   * (see `folder-trust.ts` for the failure it prevents). Only bypass mode
   * triggers that dialog, so the bridge calls this for that mode only.
   * Wired to the real `ensureFolderTrusted` in `index.ts`; absent (no-op)
   * in tests so the suite never touches `~/.claude.json`.
   */
  ensureFolderTrusted?(cwd: string): void;
  /**
   * Durable image store for the submit path. When a user turn carries
   * `images`, the bridge stages them via this store and appends an
   * `@<absPath>` token per image to the outbound tmux text. Injected in
   * `index.ts`; the materializer's read-back resolver is curried from the
   * same store.
   */
  imageStore?: ImageStore;
}

/**
 * A user turn captured before claude's TUI was ready (F1). Holds the raw
 * composer text and any image attachments verbatim — image STAGING is
 * deferred to flush time so the `@<absPath>` tokens are minted against a
 * live image store at the moment of send, identical to the warm path.
 */
interface PendingTurn {
  text: string;
  images: unknown;
}

/**
 * Cold-start readiness fallback (F1). If claude's `SessionStart` hook
 * never arrives (hooks degraded / uninstalled / an older claude), the
 * chat must not hang with its first turn stuck in the queue forever.
 * This many millis after spawn the bridge marks the chat ready anyway
 * and flushes the queue — degrading to the historical send-immediately
 * best-effort. 10s comfortably exceeds a healthy claude cold start
 * (single-digit seconds) while staying well under a user's patience
 * threshold for "nothing happened".
 */
const READY_FALLBACK_MS = 10_000;

interface ChatState {
  chatId: string;
  sessionId: string;
  cwd: string;
  jsonlPath: string;
  /** Mtime of the currently-tailed file — used by the rotation poller. */
  jsonlMtimeMs: number;
  sessionDir: string;
  state: "absent" | "starting" | "live" | "disposed";
  tail: JsonlTail;
  materializer: Materializer;
  /**
   * User-invocable slash commands discovered on disk (see user-commands.ts).
   * `skill_listing` omits them (it is model-facing), so they are merged into
   * every `slash-commands-update` frame and seeded to each connecting client.
   * Computed once at attach — the command dirs don't change mid-session.
   */
  userSlashCommands: WireSlashCommand[];
  clients: Set<WsClient>;
  pendingPermissions: Map<string, PendingPermission>;
  pendingQuestions: Map<string, PendingQuestion>;
  /** In-process permission-mode preference (does not by itself reach claude). */
  permissionMode: WirePermissionMode;
  modelSettings: Partial<WireModelSettings>;
  latestTasks: Task[];
  /** Wall-clock millis at attach time — used for first-emit latency log. */
  attachedAtMs: number;
  /** Whether at least one outbound frame has been emitted for this chat. */
  hasEmittedFrame: boolean;
  /** Whether the first user turn has been sent (drives onFirstUserTurn). */
  hasFirstSent: boolean;
  /** Whether the chat-attach hook has fired for this chat. */
  hasAttachHookFired: boolean;
  /**
   * Cold-start readiness gate (F1). `false` from the moment a fresh tmux
   * session is spawned until claude's TUI has reached its input prompt;
   * `true` once it has. The readiness EDGE is the `SessionStart` hook
   * (`routeHookEnvelope` → `case "session-start"`), with a bounded
   * fallback timer (`readyFallbackTimer`) so a degraded / absent hook
   * never hangs the chat forever.
   *
   * While `ready === false`, `submitUserTurn` does NOT send — it ENQUEUES
   * the turn onto `pendingTurns`. Sending a turn into a not-yet-prompt TUI
   * buffers the literal text and swallows the Enter; a second pre-ready
   * turn then concatenates onto the same buffered line and both submit as
   * ONE merged prompt (the confirmed cold-start race). Queue-until-ready
   * is the fix.
   */
  ready: boolean;
  /**
   * Epoch ms when the CURRENT turn entered `running`, or `null` when the
   * chat is idle. Mirrors the web reducer's `activeTurnStartedAt`. The
   * bridge broadcasts `turn-state running`/`idle` as deltas, but a
   * snapshot (WS reconnect / page refresh / second tab attach) is built
   * from state — without this field `buildSnapshotFrame` always reported
   * `idle`, so refreshing mid-turn dropped the WorkingChip and left the
   * user unable to tell a live turn from a dead one. Set on the first
   * `running` broadcast of a turn (preserved across repeat `running`
   * broadcasts within the same turn so the elapsed timer keeps counting
   * from the real start); cleared on the top-level `Stop`.
   */
  turnStartedAtMs: number | null;
  /**
   * Turns submitted before `ready` flipped true, in submission order.
   * Flushed serially (each: literal+Enter, await, then next) on the
   * readiness edge. Never sent concurrently — see `sendChain`.
   */
  pendingTurns: PendingTurn[];
  /**
   * Per-chat send-serialization mutex. Every tmux send that represents a
   * distinct user turn (live sends AND queue flushes) is chained through
   * this promise so two turns can NEVER interleave their `send-keys -l`
   * literals at the tmux layer (which would merge them before any Enter
   * submits). This is the "never concatenate two turns" invariant.
   */
  sendChain: Promise<void>;
  /**
   * Fallback timer handle. Armed at spawn; on fire it marks the chat
   * ready and flushes the queue so behaviour degrades to today's
   * best-effort send-immediately when `SessionStart` never arrives.
   * Cleared by the readiness edge (whichever wins) and on dispose.
   */
  readyFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Interval handle for the rotation poller. Claude can rotate its
   * session-id mid-conversation (a new `.jsonl` file appears in the
   * encoded-cwd directory); the poller re-runs discovery and swaps
   * the tail when that happens. Cleared on dispose.
   */
  rotationPoll: ReturnType<typeof setInterval> | undefined;
}

export interface JsonlTailBridge {
  // Lifecycle
  attach(chatId: string, client: WsClient): Promise<void>;
  detach(chatId: string, client: WsClient): void;
  hasSession(chatId: string): Promise<boolean>;
  dispose(chatId: string): Promise<void>;

  // User input
  submitUserTurn(
    chatId: string,
    text: string,
    images?: unknown,
  ): Promise<void>;
  interrupt(chatId: string): Promise<void>;
  respondToPermission(
    chatId: string,
    id: string,
    behavior: "allow" | "deny",
    opts?: { remember?: boolean; message?: string },
  ): Promise<void>;
  respondToQuestion(
    chatId: string,
    id: string,
    body: { answers: string[]; otherText?: string },
  ): Promise<void>;

  // Control surface
  setPermissionMode(chatId: string, mode: WirePermissionMode): Promise<void>;
  acceptPlanProposal(chatId: string, planId: string): Promise<void>;
  rejectPlanProposal(chatId: string, planId: string): Promise<void>;
  setModelSettings(chatId: string, patch: Partial<WireModelSettings>): Promise<void>;
  retrySession(chatId: string): Promise<void>;

  // Subscriptions
  onTasksUpdate(cb: TasksUpdateListener): () => void;

  // Hook-envelope routing.
  routeHookEnvelope(env: ChatEnvelope): void;

  // Outbound frame fan-out for routes outside the bridge (verb routes,
  // head-watcher, checkpoint reactor).
  broadcastFrameToChat(chatId: string, frame: ServerFrame): void;
  broadcastFrameToAll(frame: ServerFrame): void;

  // Cheap O(1) liveness read for the sidebar poll — reads the in-memory
  // ChatState map, no tmux probe or materializer snapshot. `null` when no
  // live session is attached.
  getLiveState(
    chatId: string,
  ): { turnState: "running" | "idle"; needsInput: boolean } | null;
}

// Cycle order Claude's TUI follows for Shift-Tab. `bypassPermissions`
// is intentionally absent — claude only enters it via the spawn-time
// `--dangerously-skip-permissions` flag and exposes no in-pane keystroke.
const CYCLE_ORDER: ReadonlyArray<WirePermissionMode> = [
  "default",
  "acceptEdits",
  "plan",
];

function cycleStepsToReach(
  from: WirePermissionMode,
  to: WirePermissionMode,
): number | null {
  const i = CYCLE_ORDER.indexOf(from);
  const j = CYCLE_ORDER.indexOf(to);
  if (i < 0 || j < 0) return null;
  return (j - i + CYCLE_ORDER.length) % CYCLE_ORDER.length;
}

export function createJsonlTailBridge(opts: JsonlTailBridgeOptions): JsonlTailBridge {
  const chats = new Map<string, ChatState>();
  const tasksListeners = new Set<TasksUpdateListener>();
  const log: BridgeLog = opts.log ?? createBridgeLog();
  // Serialize per-chat keystroke dispatch so rapid pill clicks don't
  // interleave Shift-Tabs in the wrong order — last queued click wins.
  const permissionModeQueue = new Map<string, Promise<void>>();

  function sendTo(client: WsClient, frame: ServerFrame): void {
    try {
      client.send(serializeServerFrame(frame));
    } catch {
      // Slow / dead client: best-effort detach (fan-out resilience).
      // We can't know the chatId here without a reverse index; fan-out
      // callers handle their own per-frame error trapping.
    }
  }

  function broadcast(state: ChatState, frame: ServerFrame): void {
    const dead: WsClient[] = [];
    for (const c of state.clients) {
      try {
        c.send(serializeServerFrame(frame));
      } catch {
        dead.push(c);
      }
    }
    for (const c of dead) state.clients.delete(c);
    log.emit(state.chatId, {
      kind: frame.kind,
      clients: state.clients.size,
    });
    if (!state.hasEmittedFrame) {
      state.hasEmittedFrame = true;
      log.emitFirst(state.chatId, {
        kind: frame.kind,
        latencyMs: Date.now() - state.attachedAtMs,
      });
    }
  }

  function buildSnapshotFrame(state: ChatState): SnapshotFrame {
    const snap = state.materializer.snapshot();
    return {
      kind: "snapshot",
      "chat-id": state.chatId,
      body: {
        // Honest turn-state so a reconnect / refresh / second-tab attach
        // mid-turn re-arms the WorkingChip instead of falsely reporting
        // idle. `turnStartedAt` lets the client's elapsed timer resume
        // from the real start rather than resetting to 0.
        items: snap.items as ChatItem[],
        turnState: state.turnStartedAtMs != null ? "running" : "idle",
        turnStartedAt: state.turnStartedAtMs,
        pendingPermission:
          state.pendingPermissions.size > 0
            ? [...state.pendingPermissions.values()][0]!
            : null,
        pendingQuestion:
          state.pendingQuestions.size > 0
            ? [...state.pendingQuestions.values()][0]!
            : null,
        lifecycle: "active",
      },
    };
  }

  function onTailLine(state: ChatState, rawLine: string): void {
    log.tailLine(state.chatId, { bytes: rawLine.length });
    const ctx: TranslatorCtx = {
      chatId: state.chatId,
      sessionId: state.sessionId,
    };
    const ev = translate(rawLine, ctx);
    log.translatorEvent(state.chatId, {
      kind: ev?.kind ?? null,
    });
    if (!ev) return;
    const frames = state.materializer.ingest(ev);
    for (const f of frames) {
      // The model-facing `skill_listing` catalog omits user-only commands
      // (e.g. `/weave`); fold in the disk-discovered ones so the composer
      // can autocomplete them. See user-commands.ts.
      if (f.kind === "slash-commands-update") {
        broadcast(state, {
          ...f,
          body: {
            commands: mergeSlashCommands(f.body.commands, state.userSlashCommands),
          },
        });
        continue;
      }
      broadcast(state, f);
      if (f.kind === "tasks-update") {
        state.latestTasks = f.body.tasks;
        for (const cb of tasksListeners) {
          try {
            cb(state.chatId, f.body.tasks);
          } catch {
            // Listener exceptions don't break delivery.
          }
        }
      }
    }
  }

  /**
   * Stage any image attachments and send ONE turn through tmux as a
   * single literal+Enter pair. Shared by the warm live-send path and the
   * pre-ready queue flush so both honour identical image-token minting
   * and error-frame semantics (ADR-004: never drop the user's text).
   *
   * Image staging is performed HERE (not at enqueue time) so queued turns
   * resolve `@<absPath>` tokens against the live image store at send
   * time, matching the warm path exactly.
   */
  async function sendTurn(state: ChatState, turn: PendingTurn): Promise<void> {
    let outboundText = turn.text;
    const { images } = turn;
    if (
      images !== undefined &&
      Array.isArray(images) &&
      images.length > 0 &&
      opts.imageStore
    ) {
      try {
        const staged = await opts.imageStore.stageTurnImages(
          state.chatId,
          images as UserTurnImage[],
        );
        const tokens = staged.map((s) => `@${s.absPath}`).join(" ");
        if (tokens) outboundText = `${turn.text} ${tokens}`;
      } catch (err) {
        // ADR-004: surface one typed error frame on staging failure, but
        // never drop the user's text — it still sends below.
        const message =
          err instanceof StageImageError
            ? err.message
            : `failed to attach image: ${(err as Error).message}`;
        broadcast(state, {
          kind: "error",
          "chat-id": state.chatId,
          body: { message },
        });
      }
    }
    await opts.tmux.sendInput(state.chatId, outboundText);
  }

  /**
   * Append `op` to the chat's send-serialization chain and return a
   * promise that resolves when THIS op has run. Every distinct user turn
   * routes through here so two turns can never interleave their literal
   * text at the tmux layer (the "never concatenate two turns" invariant).
   * The chain swallows prior rejections so one failed send doesn't wedge
   * every subsequent turn; the per-op promise still rejects to its own
   * awaiter.
   */
  function enqueueSend(
    state: ChatState,
    op: () => Promise<void>,
  ): Promise<void> {
    const run = state.sendChain.catch(() => {}).then(op);
    // The stored tail must not reject (so the next link starts cleanly);
    // the returned `run` keeps the rejection for the caller's try/catch.
    state.sendChain = run.catch(() => {});
    return run;
  }

  /**
   * Readiness edge (F1). Idempotent: the first call (SessionStart OR the
   * fallback timer, whichever wins) flips `ready`, cancels the fallback,
   * and drains `pendingTurns` SERIALLY through the send chain so queued
   * turns submit in order as separate prompts. Subsequent calls no-op.
   */
  function markReadyAndFlush(
    state: ChatState,
    via: "session-start" | "fallback",
  ): void {
    if (state.state === "disposed") return;
    if (state.ready) return;
    state.ready = true;
    if (state.readyFallbackTimer) {
      clearTimeout(state.readyFallbackTimer);
      state.readyFallbackTimer = undefined;
    }
    log.attach(state.chatId, {
      sessionId: state.sessionId,
      jsonlPath: state.jsonlPath,
      strategy: `ready:${via}`,
    });
    const queued = state.pendingTurns;
    state.pendingTurns = [];
    for (const turn of queued) {
      void enqueueSend(state, () => sendTurn(state, turn)).catch((err) => {
        if (err instanceof TmuxUnavailableError) {
          broadcastRuntimeUnavailable(state.chatId, err);
          return;
        }
        console.warn(
          `[loom] queued turn flush failed for ${state.chatId}: ${(err as Error).message}`,
        );
      });
    }
  }

  async function ensureChatState(chatId: string): Promise<ChatState> {
    let state = chats.get(chatId);
    if (state) return state;

    const resolvedCwd = await Promise.resolve(opts.cwdResolver(chatId));
    const entry = await opts.sessionStore.getOrCreate(chatId, resolvedCwd);
    let sessionId = entry.sessionId;
    const cwd = entry.cwd;
    const resolvedPermissionMode: WirePermissionMode = opts.permissionModeResolver
      ? await Promise.resolve(opts.permissionModeResolver(chatId))
      : "default";

    // Bystander-resistance: BIND the tail to `<sessionId>.jsonl`. The
    // persisted sessionId is the UUID we pass to claude via tmux; that is
    // the file claude SHOULD be writing to. No directory-scan at attach — a
    // bystander claude session (the user's `/weave` session, a developer's
    // direct `claude` invocation) writing in the same cwd must NOT be
    // adopted just because it is the most-recently-modified entry.
    //
    // Resolve the bound path BEFORE spawning so we can tell claude whether to
    // resume. If `<sessionId>.jsonl` already exists this chat has prior
    // history (server restart, cold tmux) and must be spawned with
    // `--resume`; spawning `--session-id` against an existing id makes claude
    // exit "session ID already in use" and the pane dies (the resume bug).
    const sessionDir = join(opts.tailRoot, encodeCwd(cwd));
    const jsonlPath = join(sessionDir, `${sessionId}.jsonl`);
    const tailStrategy = "bound";
    const isResume = existsSync(jsonlPath);

    // Folder-trust pre-seed (F4). A `bypassPermissions` spawn passes
    // `--dangerously-skip-permissions`, which makes claude block on its
    // "Is this a project you trust?" dialog in any not-yet-trusted folder.
    // loom would then type the queued first turn straight into that dialog
    // and lose it. Recording trust before the spawn keeps claude on its
    // normal cold-start path (REPL → SessionStart), where the F1 readiness
    // gate already works. Best-effort; never blocks the spawn.
    if (resolvedPermissionMode === "bypassPermissions") {
      try {
        opts.ensureFolderTrusted?.(cwd);
      } catch (err) {
        console.warn(
          `[loom] ensureFolderTrusted failed for ${chatId}: ${(err as Error).message}`,
        );
      }
    }

    await opts.tmux.ensure(chatId, cwd, sessionId, resolvedPermissionMode, isResume);

    const tail = createJsonlTail({ pollingIntervalMs: opts.tailPollingMs });
    const materializer = createMaterializer({
      chatId,
      resolveImage: opts.imageStore
        ? (absPath) => opts.imageStore!.lookupByPath(chatId, absPath)
        : undefined,
    });

    state = {
      chatId,
      sessionId,
      cwd,
      jsonlPath,
      jsonlMtimeMs: 0,
      sessionDir,
      state: "starting",
      tail,
      materializer,
      userSlashCommands: discoverUserSlashCommands(cwd),
      clients: new Set(),
      pendingPermissions: new Map(),
      pendingQuestions: new Map(),
      permissionMode: resolvedPermissionMode,
      modelSettings: {},
      latestTasks: [],
      attachedAtMs: Date.now(),
      hasEmittedFrame: false,
      hasFirstSent: false,
      hasAttachHookFired: false,
      rotationPoll: undefined,
      // Fresh spawn ⇒ not ready until SessionStart (or the fallback).
      // A RESUMED session is treated identically: claude still has to
      // re-hydrate and re-reach its prompt, and it fires SessionStart on
      // resume too, so the same edge applies. Warm sessions never reach
      // this branch — `ensureChatState` returns the existing (already-
      // ready) state up top, so a second turn on a live chat sends now.
      ready: false,
      turnStartedAtMs: null,
      pendingTurns: [],
      sendChain: Promise.resolve(),
      readyFallbackTimer: undefined,
    };
    chats.set(chatId, state);

    // Arm the no-hang fallback (F1). If SessionStart never lands, this
    // marks the chat ready and flushes the queue after a bounded delay so
    // a degraded hook pipeline degrades to best-effort, not a dead chat.
    state.readyFallbackTimer = setTimeout(() => {
      markReadyAndFlush(state!, "fallback");
    }, opts.readyFallbackMs ?? READY_FALLBACK_MS);

    tail.onLine((line) => onTailLine(state!, line));
    tail.start({ filePath: jsonlPath });
    state.state = "live";

    // Rotation poller — mid-conversation rotation handling. Claude has
    // been observed to mint a NEW `.jsonl` file in the encoded-cwd
    // directory partway through a conversation. The directory-scan we
    // ran at attach picked the most-recent file at THAT moment, but a
    // newer one can appear later. The poller re-runs discovery on
    // `rotationPollMs` (default 500ms) and swaps the tail when the
    // active file changes.
    state.rotationPoll = setInterval(() => {
      void pollForRotation(state!);
    }, opts.rotationPollMs ?? 500);

    log.attach(chatId, {
      sessionId,
      jsonlPath,
      strategy: tailStrategy,
    });

    return state;
  }

  /**
   * Re-run directory discovery; if a newer `.jsonl` file is present
   * AND the writing process descends from this chat's tmux pane PID,
   * stop the current tail and start a new one on that file. The
   * materializer is preserved across rotation — dedupe-on-event-id
   * absorbs any overlap.
   *
   * Identity gate: `paneProcess.paneOwnsFile` runs `lsof` against the
   * candidate path and walks each writer's ppid chain looking for the
   * pane root PID. This is the single authoritative answer to "is
   * this JSONL mine?" — it accepts legitimate claude session-id
   * rotation, rejects bystander claude sessions (terminal `claude`,
   * `/weave`, onboarding JSONLs), and ignores mtime races entirely.
   */
  async function pollForRotation(state: ChatState): Promise<void> {
    if (state.state === "disposed") return;
    let discovered;
    try {
      discovered = await discoverActiveJsonl(state.sessionDir);
    } catch {
      return;
    }
    if (!discovered) return;
    if (discovered.filePath === state.jsonlPath) {
      if (discovered.mtimeMs > state.jsonlMtimeMs) {
        state.jsonlMtimeMs = discovered.mtimeMs;
      }
      return;
    }
    const paneRoot = await opts.paneProcess.paneRootPid(state.chatId);
    if (paneRoot === null) return;
    const owned = await opts.paneProcess.paneOwnsFile(paneRoot, discovered.filePath);
    if (!owned) return;
    // Rotation detected and ownership confirmed. Swap the tail.
    const oldTail = state.tail;
    const newTail = createJsonlTail({ pollingIntervalMs: opts.tailPollingMs });
    state.tail = newTail;
    state.jsonlPath = discovered.filePath;
    state.jsonlMtimeMs = discovered.mtimeMs;
    // Update the inner sessionId — the new file's sessionId becomes
    // the authoritative one.
    if (discovered.sessionId && discovered.sessionId !== state.sessionId) {
      state.sessionId = discovered.sessionId;
      try {
        await opts.sessionStore.upsert(state.chatId, discovered.sessionId, state.cwd);
      } catch {
        /* best-effort */
      }
    }
    newTail.onLine((line) => onTailLine(state, line));
    newTail.start({ filePath: discovered.filePath });
    try {
      await oldTail.stop();
    } catch {
      /* ignore */
    }
    log.attach(state.chatId, {
      sessionId: state.sessionId,
      jsonlPath: state.jsonlPath,
      strategy: "rotated",
      // Flag rotations adopted while the pane-pid gate was degraded
      // (no lsof or kill-switch on). The gate's startup warning fires
      // once; without this per-adoption field, every subsequent
      // bystander adoption looks identical to a legitimate one.
      gateDegraded: opts.paneProcess.gateDegraded(),
    });
  }

  function getChat(chatId: string): ChatState | undefined {
    return chats.get(chatId);
  }

  /**
   * Build the typed runtime-unavailable error frame consumed by the UI
   * to render an install/setup banner (M3 fix). Currently only fired
   * for missing tmux; the shape generalises to other backend deps.
   */
  function runtimeUnavailableFrame(
    chatId: string,
    err: TmuxUnavailableError,
  ): ServerFrame {
    return {
      kind: "error",
      "chat-id": chatId,
      body: {
        message: err.message,
        code: "runtime-unavailable",
        details: {
          reason: "tmux",
          actionable:
            "Install tmux >= 3.0 and ensure it is on PATH — see docs/setup.md.",
        },
      },
    };
  }

  /**
   * Emit a runtime-unavailable frame via broadcast to all clients
   * attached to the chat (used by input-path methods after attach has
   * already wired ws into the chat state).
   */
  function broadcastRuntimeUnavailable(
    chatId: string,
    err: TmuxUnavailableError,
  ): void {
    const state = chats.get(chatId);
    if (!state) return;
    broadcast(state, runtimeUnavailableFrame(chatId, err));
  }

  /** Register a pending permission and broadcast it to attached clients. */
  function pushPendingPermission(
    state: ChatState,
    chatId: string,
    perm: PendingPermission,
  ): void {
    state.pendingPermissions.set(perm.id, perm);
    broadcast(state, {
      kind: "pending-permission",
      "chat-id": chatId,
      body: perm,
    });
  }

  return {
    async attach(chatId, client) {
      let state: ChatState;
      try {
        state = await ensureChatState(chatId);
      } catch (err) {
        if (err instanceof TmuxUnavailableError) {
          // M3 fix: surface a typed runtime-unavailable frame to the
          // client and return cleanly. The chat is NOT registered; the
          // UI can render a setup banner and `bridge.hasSession`
          // resolves false (delegated to `tmux.exists` which also
          // short-circuits when unavailable).
          sendTo(client, runtimeUnavailableFrame(chatId, err));
          return;
        }
        throw err;
      }
      state.clients.add(client);
      // Always deliver a snapshot frame before any subsequent deltas.
      sendTo(client, buildSnapshotFrame(state));
      // Seed the disk-discovered user-only commands (e.g. `/weave`) so they
      // autocomplete immediately, even before/without a `skill_listing`
      // attachment. Subsequent `skill_listing` frames merge these back in
      // (see onTailLine), so the model-facing catalog never drops them.
      if (state.userSlashCommands.length > 0) {
        sendTo(client, {
          kind: "slash-commands-update",
          "chat-id": state.chatId,
          body: { commands: state.userSlashCommands },
        });
      }
      if (!state.hasAttachHookFired) {
        state.hasAttachHookFired = true;
        try {
          opts.onChatAttach?.(chatId, state.cwd);
        } catch (err) {
          console.warn(
            `[loom] onChatAttach hook failed for ${chatId}: ${(err as Error).message}`,
          );
        }
      }
    },

    detach(chatId, client) {
      const state = chats.get(chatId);
      if (!state) return;
      state.clients.delete(client);
      // No drain timer, no kill, no dispose.
    },

    async hasSession(chatId) {
      return opts.tmux.exists(chatId);
    },

    async dispose(chatId) {
      const state = chats.get(chatId);
      if (!state) return;
      // Release any held PreToolUse curls — the pane is going away, so a
      // pending popup can never be answered. `deny` unblocks claude cleanly.
      opts.permissionGate?.rejectAll(chatId, {
        decision: "deny",
        reason: "Loom: session disposed before the permission request was answered.",
      });
      // Stop the rotation poller first so it cannot resurrect the
      // tail mid-dispose.
      state.state = "disposed";
      if (state.rotationPoll) {
        clearInterval(state.rotationPoll);
        state.rotationPoll = undefined;
      }
      // Cancel the cold-start fallback so it can't fire post-dispose and
      // try to flush into a killed pane.
      if (state.readyFallbackTimer) {
        clearTimeout(state.readyFallbackTimer);
        state.readyFallbackTimer = undefined;
      }
      // Drop any turns that never made it to claude — the pane is gone.
      state.pendingTurns = [];
      try {
        await state.tail.stop();
      } catch {
        /* ignore */
      }
      try {
        await opts.tmux.kill(chatId);
      } catch {
        /* ignore — idempotent */
      }
      state.clients.clear();
      state.pendingPermissions.clear();
      state.pendingQuestions.clear();
      chats.delete(chatId);
    },

    // ─── User input ──────────────────────────────────────────────────────────
    async submitUserTurn(chatId, text, images) {
      let state: ChatState;
      try {
        state = await ensureChatState(chatId);
      } catch (err) {
        if (err instanceof TmuxUnavailableError) {
          broadcastRuntimeUnavailable(chatId, err);
          return;
        }
        throw err;
      }
      if (!state.hasFirstSent) {
        state.hasFirstSent = true;
        try {
          await opts.onFirstUserTurn?.(chatId);
        } catch (err) {
          console.warn(
            `[loom] onFirstUserTurn hook failed for ${chatId}: ${(err as Error).message}`,
          );
        }
      }

      const turn: PendingTurn = { text, images };

      // Cold-start gate (F1). If claude's TUI has not yet reached its
      // input prompt, ENQUEUE rather than send — a send now would buffer
      // the literal text and swallow the Enter, and a second pre-ready
      // turn would concatenate onto the same line so both submit as one
      // merged prompt. The readiness edge (SessionStart or the fallback
      // timer) flushes the queue serially. Emit a `turn-state running`
      // affordance so the send is not silent (the existing WorkingChip
      // shows "Working" until claude's first output flips it idle).
      if (!state.ready) {
        state.pendingTurns.push(turn);
        if (state.turnStartedAtMs == null) state.turnStartedAtMs = Date.now();
        broadcast(state, {
          kind: "turn-state",
          "chat-id": chatId,
          body: { state: "running" },
        });
        return;
      }

      // Warm / ready path: send immediately, but THROUGH the per-chat
      // send chain so a rapid second turn can't interleave its literal
      // text with this one at the tmux layer (never-concatenate invariant).
      //
      // F3 — broadcast `turn-state running` on warm accept, mirroring the
      // not-ready branch above. This completes F1's running-on-send
      // coverage: previously only the cold-start (queued) branch emitted
      // running, so a warm send produced no authoritative running frame
      // and short turns flashed no WorkingChip. Broadcasting here makes
      // "running" authoritative for ALL observers — notably a second tab
      // attached to the same chat that did NOT submit (the submitting
      // client already client-seeds running locally, but a passive
      // observer has no other signal). Fired once per accepted warm turn,
      // before the send; idempotent against the client reducer (a
      // running→running frame preserves `activeTurnStartedAt`). The
      // `stop` hook's `turn-state idle` clears it at turn end.
      if (state.turnStartedAtMs == null) state.turnStartedAtMs = Date.now();
      broadcast(state, {
        kind: "turn-state",
        "chat-id": chatId,
        body: { state: "running" },
      });
      try {
        await enqueueSend(state, () => sendTurn(state, turn));
      } catch (err) {
        if (err instanceof TmuxUnavailableError) {
          broadcastRuntimeUnavailable(chatId, err);
          return;
        }
        throw err;
      }
    },

    async interrupt(chatId) {
      try {
        await opts.tmux.interrupt(chatId);
      } catch (err) {
        if (err instanceof TmuxUnavailableError) {
          broadcastRuntimeUnavailable(chatId, err);
          return;
        }
        throw err;
      }
    },

    async respondToPermission(chatId, id, behavior, respOpts) {
      const state = getChat(chatId);
      if (state) {
        state.pendingPermissions.delete(id);
        broadcast(state, {
          kind: "pending-permission",
          "chat-id": chatId,
          body: null,
        });
      }
      // Resolve the held PreToolUse hook. The receiver is awaiting this gate
      // and will hand claude the matching permissionDecision — that, not any
      // keystroke, is what unblocks the agent. No tmux send-keys here: with
      // the hook authoritative, claude never shows its own in-pane prompt, so
      // injecting a digit would land on the composer and corrupt the turn
      // (the exact "answering confuses the agent" failure this replaces).
      opts.permissionGate?.resolve(chatId, id, {
        decision: behavior,
        reason: respOpts?.message,
      });
      // Acknowledge AFTER resolving so attached clients can audit the decision
      // and clear UI affordances keyed on the id.
      if (state) {
        broadcast(state, {
          kind: "permission-resolved",
          "chat-id": chatId,
          body: { id, behavior },
        });
      }
    },

    async respondToQuestion(chatId, id, body) {
      const state = getChat(chatId);
      const pending = state?.pendingQuestions.get(id);
      if (state) {
        state.pendingQuestions.delete(id);
        broadcast(state, {
          kind: "pending-question",
          "chat-id": chatId,
          body: null,
        });
      }

      // Release the held AskUserQuestion hook with `defer` so claude proceeds
      // to render its question widget — the keystroke sequence below then
      // drives that widget. This preserves the original render→keystroke
      // ordering while making the hook an authoritative hold (no fire-and-
      // forget, no answer-before-widget race). The selected option itself is
      // conveyed by the keystrokes, NOT by the gate decision. A no-op when no
      // gate is wired (older callers / tests).
      opts.permissionGate?.resolve(chatId, id, { decision: "defer" });

      // Single-select: claude's AskUserQuestion TUI is a navigable numbered
      // list where the option's number key is a quick-select that confirms
      // in one stroke. Send the bare digit with NO trailing Enter — a
      // trailing Enter (as sendInput appends) lands on the freshly-emptied
      // composer as a stray submit, and when it races ahead of the digit it
      // confirms the default option instead of the user's pick.
      if (
        pending &&
        !pending.multiSelect &&
        !body.answers.includes("__freeform__") &&
        pending.options &&
        pending.options.length > 0
      ) {
        const idx = pending.options.findIndex((o) => o.id === body.answers[0]);
        if (idx >= 0) {
          await opts.tmux.sendKey(chatId, String(idx + 1));
          return;
        }
      }

      // Multi-select: in claude's widget the number keys TOGGLE each checkbox
      // (they do not confirm). After toggling, "Right" opens the Submit review
      // tab where "1" ("Submit answers") confirms. Verified against claude
      // v2.1.150's AskUserQuestion multi-select widget.
      if (
        pending &&
        pending.multiSelect &&
        !body.answers.includes("__freeform__") &&
        pending.options &&
        pending.options.length > 0
      ) {
        let toggled = 0;
        for (const ansId of body.answers) {
          const idx = pending.options.findIndex((o) => o.id === ansId);
          if (idx >= 0) {
            await opts.tmux.sendKey(chatId, String(idx + 1));
            toggled++;
          }
        }
        if (toggled > 0) {
          await opts.tmux.sendKey(chatId, "Right");
          await opts.tmux.sendKey(chatId, "1");
          return;
        }
      }

      // Freeform "Other": claude appends a "Type something" row right after
      // the parsed options. Its number key only MOVES the cursor there (it
      // does not confirm); typing then fills the row inline and Enter submits.
      // So navigate with the bare key, then sendInput supplies the text + the
      // confirming Enter. Verified against claude v2.1.150 (single-select).
      if (body.answers.includes("__freeform__")) {
        const text = body.otherText ?? "";
        if (pending && !pending.multiSelect && pending.options && pending.options.length > 0) {
          await opts.tmux.sendKey(chatId, String(pending.options.length + 1));
          await opts.tmux.sendInput(chatId, text);
          return;
        }
        // Multi-select freeform / lost-pending-state: best-effort plain text.
        await opts.tmux.sendInput(chatId, text);
        return;
      }

      // Lost-pending-state fallback: no options to map against, so type the
      // first answer id raw as a submitted turn.
      let toSend: string;
      if (pending && pending.options && pending.options.length > 0) {
        const firstAnswerId = body.answers[0];
        const idx = pending.options.findIndex((o) => o.id === firstAnswerId);
        toSend = idx >= 0 ? String(idx + 1) : (firstAnswerId ?? "");
      } else {
        toSend = body.answers[0] ?? "";
      }
      await opts.tmux.sendInput(chatId, toSend);
    },

    // ─── Control surface ─────────────────────────────────────────────────────
    async setPermissionMode(chatId, mode) {
      const state = await ensureChatState(chatId);
      const prev = state.permissionMode;
      // No reverse channel exists from claude's TUI back into bridge state:
      // a user pressing Shift-Tab inside an attached real terminal will
      // drift `state.permissionMode` from what claude is actually showing
      // and subsequent cycle-step counts will be off.
      state.permissionMode = mode;

      let updatedRow: unknown = null;
      if (opts.persistPermissionMode) {
        try {
          updatedRow = await Promise.resolve(
            opts.persistPermissionMode(chatId, mode),
          );
        } catch (err) {
          console.warn(
            `[loom] persistPermissionMode failed for ${chatId}: ${(err as Error).message}`,
          );
        }
      }

      const prior = permissionModeQueue.get(chatId) ?? Promise.resolve();
      const next = prior
        .catch(() => {})
        .then(async () => {
          if (mode === "bypassPermissions") {
            broadcast(state, {
              kind: "error",
              "chat-id": chatId,
              body: {
                message:
                  "Bypass permissions can only be enabled when starting a new session; the choice is saved and will apply next time.",
              },
            });
            return;
          }
          if (prev === "bypassPermissions") {
            // Bypass mode is set via a spawn-time CLI flag and has no
            // in-pane keystroke to leave it; row is already updated so
            // the next session honours the new choice.
            broadcast(state, {
              kind: "error",
              "chat-id": chatId,
              body: {
                message:
                  "This session was started in bypass-permissions mode and cannot switch out without restart; the choice is saved and will apply next time.",
              },
            });
            return;
          }
          const steps = cycleStepsToReach(prev, mode);
          if (steps == null || steps === 0) return;
          for (let i = 0; i < steps; i++) {
            try {
              await opts.tmux.sendKey(chatId, "BTab");
            } catch (err) {
              // Mid-cycle failure leaves the running pane on an
              // intermediate mode. Roll back in-memory + persisted
              // state and broadcast a corrective frame so the pill
              // reflects what claude is actually running.
              console.warn(
                `[loom] permission-mode keystroke failed mid-cycle for ${chatId}: ${(err as Error).message}`,
              );
              state.permissionMode = prev;
              if (opts.persistPermissionMode) {
                try {
                  await Promise.resolve(opts.persistPermissionMode(chatId, prev));
                } catch {
                  /* best-effort rollback */
                }
              }
              broadcast(state, {
                kind: "permission-mode-set",
                "chat-id": chatId,
                body: { mode: prev },
              });
              broadcast(state, {
                kind: "error",
                "chat-id": chatId,
                body: {
                  message: `Failed to switch permission mode; reverted to ${prev}.`,
                },
              });
              return;
            }
          }
        });
      permissionModeQueue.set(chatId, next);
      next.finally(() => {
        if (permissionModeQueue.get(chatId) === next) {
          permissionModeQueue.delete(chatId);
        }
      });

      broadcast(state, {
        kind: "permission-mode-set",
        "chat-id": chatId,
        body: { mode },
      });
      if (updatedRow && typeof updatedRow === "object") {
        broadcast(state, {
          kind: "chat-update",
          "chat-id": chatId,
          body: { chat: updatedRow as ChatRow },
        });
      }
      await next;
    },

    async acceptPlanProposal(chatId, _planId) {
      // Reuses the permission-flow path: the user "accepts" the plan by
      // sending the accept literal into the tmux session. Catalog: plan
      // proposals (when present) ride the same numbered-choice protocol.
      await opts.tmux.sendInput(chatId, "1");
    },

    async rejectPlanProposal(chatId, _planId) {
      await opts.tmux.sendInput(chatId, "2");
    },

    async setModelSettings(chatId, patch) {
      const state = await ensureChatState(chatId);
      state.modelSettings = { ...state.modelSettings, ...patch };
      // Emit /model slash-command literal — the slash-command path is
      // the only model toggle.
      //
      // TODO(m3): `/model` argument grammar is unconfirmed. Only the
      // `<command-name>/model</command-name>` form typed alone has been
      // observed in JSONL, after
      // which `claude` renders an interactive picker — there is no
      // recorded evidence that `claude` accepts `--effort=` /
      // `--context=` flags here. The current best-effort grammar below
      // is preserved to avoid silently regressing the existing wire
      // contract; m3 cleanup deferred pending a live re-mining session
      // that confirms (or refutes) the argument shape. If `claude`
      // rejects the argument string, the tmux session shows the
      // rejection and the user can correct it interactively — see
      // `review.md` §m3 for the audit trail.
      const args: string[] = [];
      if (patch.model != null) args.push(patch.model);
      if (patch.effort != null) args.push(`--effort=${patch.effort}`);
      if (patch.contextWindow != null) args.push(`--context=${patch.contextWindow}`);
      await opts.tmux.sendInput(chatId, `/model ${args.join(" ")}`.trim());
    },

    async retrySession(chatId) {
      await opts.tmux.kill(chatId);
      await opts.sessionStore.delete(chatId);
      const state = chats.get(chatId);
      if (state) {
        state.materializer.reset();
        state.turnStartedAtMs = null;
        broadcast(state, buildSnapshotFrame(state));
      }
      // The next ensureChatState call will mint a fresh sessionId.
    },

    // ─── Subscriptions ───────────────────────────────────────────────────────
    onTasksUpdate(cb) {
      tasksListeners.add(cb);
      return () => {
        tasksListeners.delete(cb);
      };
    },

    // ─── Hook-envelope routing ───────────────────────────────────────────────
    routeHookEnvelope(env) {
      const chatId = env["chat-id"];
      if (!chatId) return;
      const state = chats.get(chatId);
      if (!state) return; // unknown chat — silently drop.

      traceHook("route", {
        chat: chatId,
        kind: env.kind,
        body: env.body ?? null,
      });

      switch (env.kind) {
        case "gate-pending": {
          const body = env.body as
            | { kind?: string; data?: Record<string, unknown> }
            | undefined;
          if (!body) return;
          if (body.kind === "permissionrequest") {
            const data = body.data ?? {};
            const id =
              (data.id as string | undefined) ?? `perm-${Date.now()}`;
            pushPendingPermission(state, chatId, {
              id,
              toolName: (data.toolName as string | undefined) ?? "",
              input: (data.input as Record<string, unknown> | undefined) ?? {},
              title: data.title as string | undefined,
              displayName: data.displayName as string | undefined,
              description: data.description as string | undefined,
            });
            return;
          }
          if (body.kind === "askuserquestion") {
            const data = body.data ?? {};
            const id =
              (data.id as string | undefined) ?? `q-${Date.now()}`;
            const q: PendingQuestion = {
              id,
              question: (data.question as string | undefined) ?? "",
              options:
                (data.options as PendingQuestion["options"] | undefined) ?? [],
              multiSelect: (data.multiSelect as boolean | undefined),
            };
            state.pendingQuestions.set(id, q);
            broadcast(state, {
              kind: "pending-question",
              "chat-id": chatId,
              body: q,
            });
            return;
          }
          return;
        }
        case "session-start":
          // Readiness edge (F1): claude's TUI is up and at its prompt.
          // Flip `ready` and flush any turns the user submitted during
          // the cold-start window, serially and in order. Idempotent on
          // repeat SessionStarts (e.g. resume re-fires it).
          markReadyAndFlush(state, "session-start");
          broadcast(state, {
            kind: "session-state",
            "chat-id": chatId,
            body: { lifecycle: "active" },
          });
          return;
        case "stop": {
          // Only the TOP-LEVEL `Stop` ends the turn. `SubagentStop` fires
          // every time a Task/Explore subagent finishes WHILE the parent
          // agent is still running — treating it as turn-end would flip
          // the chat to `idle` mid-turn, vanishing the WorkingChip even
          // though work continues. Since nothing re-arms `running` until
          // the next user submit, the indicator would then stay dark for
          // the rest of the turn (the "I can't tell if it died" symptom).
          // SubagentStop's gate-clearing already happened in the receiver;
          // here we simply ignore it for turn-state purposes.
          const stopKind = (env.body as { kind?: string } | undefined)?.kind;
          if (stopKind === "SubagentStop") return;
          state.turnStartedAtMs = null;
          broadcast(state, {
            kind: "turn-state",
            "chat-id": chatId,
            body: { state: "idle" },
          });
          try {
            opts.onAssistantTurnComplete?.(chatId, state.cwd);
          } catch (err) {
            console.warn(
              `[loom] onAssistantTurnComplete hook failed for ${chatId}: ${(err as Error).message}`,
            );
          }
          return;
        }
        case "pre-tool-use": {
          // pre-tool-use carries the permission-prompt side-channel.
          const body = env.body as
            | { toolName?: string; payload?: Record<string, unknown> }
            | undefined;
          const payload = body?.payload ?? {};
          const id = (payload.id as string | undefined) ?? `pre-${Date.now()}`;
          pushPendingPermission(state, chatId, {
            id,
            toolName: body?.toolName ?? (payload.toolName as string) ?? "",
            input: (payload.input as Record<string, unknown> | undefined) ?? {},
            title: payload.title as string | undefined,
            displayName: payload.displayName as string | undefined,
            description: payload.description as string | undefined,
            toolUseId: payload.toolUseId as string | undefined,
          });
          return;
        }
        default:
          return;
      }
    },

    // ─── Outbound frame fan-out for non-bridge frame producers ───────────────
    broadcastFrameToChat(chatId, frame) {
      const state = chats.get(chatId);
      if (!state) return;
      broadcast(state, frame);
    },
    broadcastFrameToAll(frame) {
      for (const state of chats.values()) {
        broadcast(state, frame);
      }
    },
    getLiveState(chatId) {
      const state = chats.get(chatId);
      if (!state) return null;
      return {
        turnState: state.turnStartedAtMs != null ? "running" : "idle",
        needsInput:
          state.pendingPermissions.size > 0 || state.pendingQuestions.size > 0,
      };
    },
  };
}
