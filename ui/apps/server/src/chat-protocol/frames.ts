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
  body: { text: string };
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
    id: string;
    /** Chosen option id, or "__freeform__" to use freeform text. */
    choice: string;
    freeform?: string;
  };
}

export type ClientFrame =
  | AttachFrame
  | DetachFrame
  | UserTurnFrame
  | InterruptFrame
  | PermissionResponseFrame
  | QuestionResponseFrame;

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
  | ErrorFrame;
