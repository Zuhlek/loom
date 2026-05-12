/**
 * Mirror of `apps/server/src/chat-protocol/messages.ts` + `frames.ts`.
 *
 * Kept in sync by hand. Any change to the wire shape must land on both
 * sides or the WS payload won't deserialise. Use the structural unions
 * — discriminated by `kind` for items / `kind` for frames.
 */

export type ChatItemId = string;
export type TurnId = string;
export type ToolUseId = string;

export interface AssistantTextBlock {
  type: "text";
  text: string;
  /**
   * T-002 / US-002 (chat-streaming-fixes), ADR-004. Bridge-internal
   * marker for dense-array filler blocks produced by
   * `claude-session-bridge.ts` when `content_block_start` arrives at an
   * index past the current `blocks.length`. The web's `AssistantRow.map`
   * filters these out before discrimination so the streaming caret can't
   * land on an invisible node. Excess metadata on an otherwise legal
   * text block — NOT a new wire variant. Mirror of the server's
   * `AssistantTextBlock._placeholder` field; both sides must declare it
   * to keep `wire-mirror-drift.test.ts` passing.
   */
  _placeholder?: boolean;
}

export interface AssistantThinkingBlock {
  type: "thinking";
  text: string;
}

export interface AssistantToolUseBlock {
  type: "tool_use";
  id: ToolUseId;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: ToolResultSummary;
}

/**
 * One image block extracted from a tool_result content array. The
 * bridge transports the base-64 payload + media-type straight through;
 * the web client constructs a `data:<mediaType>;base64,<dataB64>`
 * URL for the `<img>` `src` attribute. No blob URLs (ADR-006).
 */
export interface ToolResultImage {
  mediaType: string;
  dataB64: string;
  alt?: string;
}

export interface ToolResultSummary {
  text: string;
  isError: boolean;
  /** Optional images extracted from the SDK tool_result content array (ADR-007). */
  images?: ToolResultImage[];
}

export type AssistantBlock = AssistantTextBlock | AssistantThinkingBlock | AssistantToolUseBlock;

/**
 * One image attachment surfaced on a `UserMessageItem`. Mirrors the
 * server `UserMessageImage` byte-for-byte (see
 * `apps/server/src/chat-protocol/messages.ts`). The web client builds
 * `data:<mediaType>;base64,<dataB64>` URLs for `<img>` `src` — same
 * inline-data pattern as `ToolResultImage` (ADR-006).
 */
export interface UserMessageImage {
  mediaType: string;
  dataB64: string;
  filename?: string;
}

export interface UserMessageItem {
  kind: "user-message";
  id: ChatItemId;
  turnId: TurnId;
  text: string;
  createdAt: string;
  /**
   * Image attachments included with this turn. Absent for text-only
   * legacy items / older snapshots (US-007 AC3).
   */
  images?: UserMessageImage[];
}

export interface AssistantMessageItem {
  kind: "assistant-message";
  id: ChatItemId;
  turnId: TurnId;
  blocks: AssistantBlock[];
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SystemNoticeItem {
  kind: "system-notice";
  id: ChatItemId;
  text: string;
  level: "info" | "error";
  createdAt: string;
}

/**
 * US-003. Chat-level interactive plan proposal — mirrors the server
 * `PlanProposedItem` byte-for-byte. The `ProposedPlanCard` renders this
 * with Accept/Reject buttons while `status === "pending"`; post-decision
 * the card stays visible with greyed-out controls as an audit row.
 */
export interface PlanProposedItem {
  kind: "plan-proposed";
  id: ChatItemId;
  /** Unix ms timestamp of when the bridge first observed the tool_use. */
  ts: number;
  /** Plan body extracted from the SDK's `ExitPlanMode` tool_use `input.plan`. */
  planText: string;
  status: "pending" | "accepted" | "rejected";
}

export type ChatItem =
  | UserMessageItem
  | AssistantMessageItem
  | SystemNoticeItem
  | PlanProposedItem;

export type TurnState = "idle" | "running" | "interrupted" | "error";

/**
 * Session-lifetime resilience state — mirrors the server
 * `SessionLifecycle` byte-for-byte. Orthogonal to `TurnState`: drives
 * the recovery banner while the bridge auto-respawns the SDK after a
 * mid-session crash. See `claude-session-bridge.ts` `handleSessionFailure`.
 */
export type SessionLifecycle = "active" | "recovering" | "failed";

export interface PendingPermission {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  toolUseId?: ToolUseId;
}

export interface PendingQuestion {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface ChatSnapshot {
  items: ChatItem[];
  turnState: TurnState;
  lastError?: string;
  pendingPermission?: PendingPermission | null;
  pendingQuestion?: PendingQuestion | null;
  /**
   * Session-lifetime resilience state. Defaults to `"active"` on the
   * client when the field is absent (older server snapshots).
   */
  lifecycle?: SessionLifecycle;
  /** Auto-retry counter for the current failure streak. */
  recoveryAttempt?: number;
}

/**
 * SDK PermissionMode subset surfaced on the wire. Mirrors the four
 * modes US-004 AC1 exposes in the composer dropdown — matches the
 * server `WirePermissionMode` byte-for-byte.
 */
export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

/**
 * One image attachment on an outbound `user-turn` frame. Mirrors the
 * server `UserTurnImage` byte-for-byte (see
 * `apps/server/src/chat-protocol/frames.ts`). The composer captures
 * this via paste / paperclip / drag-drop and the bridge fans it out
 * into SDK `ImageBlockParam` content blocks.
 */
export interface UserTurnImage {
  mediaType: string;
  dataB64: string;
  filename?: string;
}

// ─── Frames ───────────────────────────────────────────────────────────

export type ServerFrame =
  | { kind: "attached"; "chat-id": string; body: { ok: true } }
  | { kind: "snapshot"; "chat-id": string; body: ChatSnapshot }
  | { kind: "item-append"; "chat-id": string; body: { item: ChatItem } }
  | { kind: "item-update"; "chat-id": string; body: { item: ChatItem } }
  | { kind: "turn-state"; "chat-id": string; body: { state: TurnState; lastError?: string } }
  | { kind: "pending-permission"; "chat-id": string; body: PendingPermission | null }
  | { kind: "pending-question"; "chat-id": string; body: PendingQuestion | null }
  | { kind: "tasks-update"; "chat-id": string; body: { tasks: Task[]; replay?: boolean } }
  | {
      /**
       * Session-lifetime state transition. Drives the recovery banner.
       * See `SessionLifecycle` for the state machine. Distinct from
       * `turn-state` (which tracks the current turn only).
       */
      kind: "session-state";
      "chat-id": string;
      body: {
        lifecycle: SessionLifecycle;
        recoveryAttempt?: number;
        lastError?: string;
      };
    }
  | { kind: "error"; "chat-id"?: string; body: { message: string } };

export type ClientFrame =
  | { kind: "attach"; "chat-id": string }
  | { kind: "detach"; "chat-id": string }
  | {
      kind: "user-turn";
      "chat-id": string;
      body: {
        text: string;
        /**
         * SDK priority hint. Mirrors `SDKUserMessage.priority`. Server
         * defaults to "now" when omitted; the composer sends "next"
         * when the queue-priority toggle is on (running turn).
         */
        priority?: "now" | "next" | "later";
        /**
         * Optional image attachments captured by the composer (paste,
         * paperclip, or drag-drop). Mirrors the server-side
         * `UserTurnFrame.body.images` field byte-for-byte; the bridge
         * fans these out into SDK `ImageBlockParam` content blocks.
         * Absent on legacy text-only submits.
         */
        images?: UserTurnImage[];
      };
    }
  | { kind: "interrupt"; "chat-id": string }
  | {
      kind: "permission-response";
      "chat-id": string;
      body: { id: string; behavior: "allow" | "deny"; remember?: boolean; message?: string };
    }
  | {
      kind: "question-response";
      "chat-id": string;
      /**
       * `answers` is an array (length 1 for single-select, ≥1 for
       * multi-select). When the user picks the "Other" escape hatch
       * the sentinel `"__freeform__"` is included in `answers` and
       * `otherText` carries the typed body. Mirrors the server
       * `QuestionResponseFrame` byte-for-byte.
       */
      body: { id: string; answers: string[]; otherText?: string };
    }
  | {
      kind: "permission-mode-set";
      "chat-id": string;
      body: { mode: PermissionMode };
    }
  | {
      /**
       * T-003 / US-003 AC3. Accept the latest `plan-proposed` item.
       * The server bridge calls `setPermissionMode("default")` and
       * queues an "execute the plan" user-turn (see Design
       * `## Plan-proposed lifecycle`). Per ADR-004 no composer draft
       * is auto-submitted.
       */
      kind: "plan-accept";
      "chat-id": string;
      body: { planId: string };
    }
  | {
      /**
       * T-003 / US-003 AC4. Reject the latest `plan-proposed` item.
       * The server bridge queues a reconsider user-turn and leaves
       * permission mode at `"plan"`.
       */
      kind: "plan-reject";
      "chat-id": string;
      body: { planId: string };
    }
  | {
      /**
       * Manually re-run recovery after the bridge gave up auto-respawn
       * (lifecycle = "failed"). Bridge no-ops if the session is already
       * active or recovering.
       */
      kind: "retry-session";
      "chat-id": string;
    };

export interface Task {
  step: string;
  status: "pending" | "inProgress" | "completed";
  activeForm?: string;
}
