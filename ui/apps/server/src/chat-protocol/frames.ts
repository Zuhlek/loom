/**
 * Wire-frame definitions for the structured chat WebSocket protocol.
 *
 * All frames share the legacy envelope shape `{ kind, "chat-id", body }`
 * (see envelope.ts). This file gives a typed union of the new SDK-backed
 * frame kinds so the bridge and the web client can stay aligned.
 */
import type { ChatRow } from "../metadata-store/repos/chat.ts";
import type {
  ChatItem,
  ChatSnapshot,
  PendingPermission,
  PendingQuestion,
  SessionLifecycle,
  Task,
  TurnState,
  WireModelSettings,
  WireSlashCommand,
} from "./messages.ts";

export type { WireModelSettings, WireSlashCommand };

// ─── Client → Server ─────────────────────────────────────────────────

export interface AttachFrame {
  kind: "attach";
  "chat-id": string;
}

export interface DetachFrame {
  kind: "detach";
  "chat-id": string;
}

export interface UserTurnFrame {
  kind: "user-turn";
  "chat-id": string;
  body: {
    text: string;
    /**
     * SDK priority hint for the queued user message. Mirrors the SDK's
     * `SDKUserMessage.priority` enum exactly per Design `## Wire
     * protocol additions` — no translation table. Server defaults the
     * value to `"now"` when omitted so legacy `{ text }`-only submits
     * keep working.
     */
    priority?: "now" | "next" | "later";
    /**
     * Optional image attachments captured by the composer (paste from
     * clipboard, paperclip file picker, or drag-drop). Each entry is a
     * base64 payload + MIME type. The bridge fans these out into
     * `ImageBlockParam` content blocks on the `SDKUserMessage`. Absent
     * on legacy text-only submits — back-compat with pre-attachment
     * clients is preserved by the optional marker.
     */
    images?: UserTurnImage[];
  };
}

/**
 * One image attachment on an outbound user turn. Mirrors the
 * `ToolResultImage` shape on the inbound side (base64 + media-type, no
 * `data:` prefix) so the web client can reuse the same encoder.
 */
export interface UserTurnImage {
  /** MIME type, e.g. `"image/png"`, `"image/jpeg"`. */
  mediaType: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  dataB64: string;
  /** Optional source filename — surfaced in the bubble for context. */
  filename?: string;
}

export interface InterruptFrame {
  kind: "interrupt";
  "chat-id": string;
}

export interface PermissionResponseFrame {
  kind: "permission-response";
  "chat-id": string;
  body: {
    id: string;
    behavior: "allow" | "deny";
    /** When true, the bridge applies the suggested `addRules` updates so the user isn't re-prompted. */
    remember?: boolean;
    /** Optional decline reason shown to claude. */
    message?: string;
  };
}

export interface QuestionResponseFrame {
  kind: "question-response";
  "chat-id": string;
  body: {
    /** Question id matching the open `PendingQuestion.id`. */
    id: string;
    /**
     * Array of chosen option ids. Single-select submits a length-1
     * array; multi-select submits length ≥ 1. The sentinel
     * `"__freeform__"` is included in `answers` when the user picks
     * the "Other" escape hatch, in which case `otherText` carries the
     * typed body.
     */
    answers: string[];
    /** Typed free-text content when `"__freeform__"` is in `answers`. */
    otherText?: string;
  };
}

/**
 * SDK PermissionMode subset surfaced on the wire. Matches the SDK's
 * `PermissionMode` enum exactly for the four modes the composer
 * dropdown exposes — the SDK-internal `dontAsk` / `auto` variants
 * are intentionally omitted.
 */
export type WirePermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

export interface PermissionModeSetFrame {
  kind: "permission-mode-set";
  "chat-id": string;
  body: { mode: WirePermissionMode };
}

/**
 * Accept the latest `plan-proposed` item.
 *
 * Bridge handler: `bridge.acceptPlanProposal(chatId, planId)` calls
 * `Query.setPermissionMode("default")` and queues a user-turn
 * ("Please execute the plan as proposed"). The plan-proposed item's
 * status flips to `"accepted"` via an item-update broadcast.
 *
 * NOT debounced; NOT coalesced with composer-footer permission-mode
 * changes. Accept does NOT auto-submit any composer draft — only
 * the dedicated execute user-turn is queued.
 */
export interface PlanAcceptFrame {
  kind: "plan-accept";
  "chat-id": string;
  body: { planId: string };
}

/**
 * Reject the latest `plan-proposed` item.
 *
 * Bridge handler: `bridge.rejectPlanProposal(chatId, planId)` queues
 * a user-turn ("Please reconsider the plan; do not execute it
 * as-is") WITHOUT touching permission mode (the SDK stays in
 * `"plan"`). The item's status flips to `"rejected"`.
 */
export interface PlanRejectFrame {
  kind: "plan-reject";
  "chat-id": string;
  body: { planId: string };
}

/**
 * Manually trigger a recovery attempt after the bridge gave up
 * auto-respawning (lifecycle = "failed"). Idempotent; if the session is
 * already recovering or active, the bridge no-ops.
 *
 * Bridge handler: `bridge.retrySession(chatId)`. On success the bridge
 * emits a `session-state` frame flipping lifecycle through
 * `recovering → active`; on failure it flips back to `failed` with the
 * fresh error message attached.
 */
export interface RetrySessionFrame {
  kind: "retry-session";
  "chat-id": string;
}

/**
 * Partial patch of {@link WireModelSettings}. Server merges over the
 * existing chat-row JSON so a single-pill change carries one field.
 */
export interface ModelSettingsSetFrame {
  kind: "model-settings-set";
  "chat-id": string;
  body: Partial<WireModelSettings>;
}

export type ClientFrame =
  | AttachFrame
  | DetachFrame
  | UserTurnFrame
  | InterruptFrame
  | PermissionResponseFrame
  | QuestionResponseFrame
  | PermissionModeSetFrame
  | PlanAcceptFrame
  | PlanRejectFrame
  | RetrySessionFrame
  | ModelSettingsSetFrame;

// ─── Server → Client ─────────────────────────────────────────────────

export interface AttachedFrame {
  kind: "attached";
  "chat-id": string;
  body: { ok: true };
}

export interface SnapshotFrame {
  kind: "snapshot";
  "chat-id": string;
  body: ChatSnapshot;
}

export interface ItemAppendFrame {
  kind: "item-append";
  "chat-id": string;
  body: { item: ChatItem };
}

export interface ItemUpdateFrame {
  kind: "item-update";
  "chat-id": string;
  body: { item: ChatItem };
}

export interface TurnStateFrame {
  kind: "turn-state";
  "chat-id": string;
  body: { state: TurnState; lastError?: string };
}

export interface PendingPermissionFrame {
  kind: "pending-permission";
  "chat-id": string;
  body: PendingPermission | null;
}

export interface PendingQuestionFrame {
  kind: "pending-question";
  "chat-id": string;
  body: PendingQuestion | null;
}

export interface TasksUpdateFrame {
  kind: "tasks-update";
  "chat-id": string;
  body: { tasks: Task[]; replay?: boolean };
}

export interface ErrorFrame {
  kind: "error";
  "chat-id"?: string;
  body: { message: string };
}

/**
 * Session-lifetime state transition. Emitted whenever the bridge moves
 * a session through `active ↔ recovering ↔ failed` (see
 * `SessionLifecycle`). The web client uses this to drive the recovery
 * banner — distinct from `turn-state`, which tracks the current turn
 * only. `recoveryAttempt` is the auto-retry counter for the current
 * failure streak; `lastError` is the most recent SDK error string.
 */
export interface SessionStateFrame {
  kind: "session-state";
  "chat-id": string;
  body: {
    lifecycle: SessionLifecycle;
    recoveryAttempt?: number;
    lastError?: string;
  };
}

/**
 * Push the latest chat row to attached clients. Emitted by the bridge
 * when `worktree_path` (and other bridge-owned fields) become known —
 * the row is freshly resolved at spawn time and only the in-memory copy
 * has it, so the web client's mount-time `getChat` snapshot is stale
 * until this frame patches it in.
 */
export interface ChatUpdateFrame {
  kind: "chat-update";
  "chat-id": string;
  body: { chat: ChatRow };
}

/** Push the SDK-enumerated catalog. Fired on attach and on reload. */
export interface SlashCommandsUpdateFrame {
  kind: "slash-commands-update";
  "chat-id": string;
  body: { commands: WireSlashCommand[] };
}

/** Push the SDK context-window breakdown. Fired post-turn. */
export interface ContextUsageUpdateFrame {
  kind: "context-usage-update";
  "chat-id": string;
  body: {
    /** 0..100, rounded by the bridge. */
    percentage: number;
    totalTokens: number;
    maxTokens: number;
    model: string;
  };
}

export type ServerFrame =
  | AttachedFrame
  | SnapshotFrame
  | ItemAppendFrame
  | ItemUpdateFrame
  | TurnStateFrame
  | PendingPermissionFrame
  | PendingQuestionFrame
  | TasksUpdateFrame
  | SessionStateFrame
  | ChatUpdateFrame
  | SlashCommandsUpdateFrame
  | ContextUsageUpdateFrame
  | ErrorFrame;

/**
 * Serialise a typed ServerFrame to the on-wire JSON string. The
 * single place untyped envelope writes are funnelled through —
 * preserves the wire's type-safety boundary.
 *
 * Wire shape is preserved verbatim — `JSON.stringify` is a no-op on the
 * envelope structure. The helper exists so the type-check fires before
 * the bytes hit the socket, replacing the prior `JSON.stringify({...})`
 * call sites that bypassed the union.
 */
export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}
