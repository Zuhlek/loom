/**
 * Wire-frame definitions for the structured chat WebSocket protocol.
 *
 * All frames share the legacy envelope shape `{ kind, "chat-id", body }`
 * (see envelope.ts). This file gives a typed union of the new SDK-backed
 * frame kinds so the bridge and the web client can stay aligned.
 */
import type {
  ChatItem,
  ChatSnapshot,
  PendingPermission,
  PendingQuestion,
  Task,
  TurnState,
} from "./messages.ts";

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
  };
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
 * `PermissionMode` enum exactly for the four modes US-004 AC1 exposes
 * in the composer dropdown — the SDK-internal `dontAsk` / `auto`
 * variants are intentionally omitted.
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
 * T-003 / US-003. Accept the latest `plan-proposed` item.
 *
 * Bridge handler: `bridge.acceptPlanProposal(chatId, planId)` calls
 * `Query.setPermissionMode("default")` and queues a user-turn ("Please
 * execute the plan as proposed"). The plan-proposed item's status
 * flips to `"accepted"` via an item-update broadcast.
 *
 * Per ADR-004: NOT debounced; NOT coalesced with composer-footer
 * permission-mode changes. Accept does NOT auto-submit any composer
 * draft — only the dedicated execute user-turn is queued.
 */
export interface PlanAcceptFrame {
  kind: "plan-accept";
  "chat-id": string;
  body: { planId: string };
}

/**
 * T-003 / US-003. Reject the latest `plan-proposed` item.
 *
 * Bridge handler: `bridge.rejectPlanProposal(chatId, planId)` queues a
 * user-turn ("Please reconsider the plan; do not execute it as-is")
 * WITHOUT touching permission mode (the SDK stays in `"plan"`). The
 * item's status flips to `"rejected"`.
 */
export interface PlanRejectFrame {
  kind: "plan-reject";
  "chat-id": string;
  body: { planId: string };
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
  | PlanRejectFrame;

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

export type ServerFrame =
  | AttachedFrame
  | SnapshotFrame
  | ItemAppendFrame
  | ItemUpdateFrame
  | TurnStateFrame
  | PendingPermissionFrame
  | PendingQuestionFrame
  | TasksUpdateFrame
  | ErrorFrame;

/**
 * Serialise a typed ServerFrame to the on-wire JSON string. The single
 * place untyped envelope writes are funnelled through, restoring the
 * type-safety boundary mandated by Spec `## Constraints` and US-009.
 *
 * Wire shape is preserved verbatim — `JSON.stringify` is a no-op on the
 * envelope structure. The helper exists so the type-check fires before
 * the bytes hit the socket, replacing the prior `JSON.stringify({...})`
 * call sites that bypassed the union.
 */
export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame);
}
