/**
 * Structured chat message types — shared by server + web.
 *
 * Each chat has a strictly ordered list of `ChatItem`s. New items are
 * appended; existing items are updated in place by id (the bridge sends
 * `item-update` to overwrite an item — used for streaming text and
 * tool-use status transitions).
 *
 * Items are deliberately wire-friendly POJOs; both server and web import
 * from this file via a path-aliased copy under web (kept in sync by hand).
 */

export type ChatItemId = string;
export type TurnId = string;
export type ToolUseId = string;

/** Text block in an assistant message. */
export interface AssistantTextBlock {
  type: "text";
  text: string;
  /**
   * T-002 / US-002 (chat-streaming-fixes), ADR-004. Bridge-internal
   * marker used by the dense-blocks invariant: when the SDK's
   * `content_block_start` arrives at an index past `aitem.blocks.length`,
   * the bridge backfills intermediate slots with
   * `{ type: "text", text: "", _placeholder: true }` so the array stays
   * dense end-to-end and survives `JSON.stringify` without holes turning
   * into literal `null`s. The web's `AssistantRow.map` filters these out
   * before block-type discrimination runs. Excess metadata on an
   * otherwise legal `AssistantTextBlock` — NOT a new wire variant.
   */
  _placeholder?: boolean;
}

/** Thinking block — surfaced when the model exposes its reasoning. */
export interface AssistantThinkingBlock {
  type: "thinking";
  text: string;
}

/** Tool call block embedded in an assistant message. */
export interface AssistantToolUseBlock {
  type: "tool_use";
  id: ToolUseId;
  name: string;
  input: Record<string, unknown>;
  /** Live status — flips to "complete" or "error" when the result arrives. */
  status: "running" | "complete" | "error";
  /** Filled when the tool returns. May be a short summary; full result not always rendered. */
  result?: ToolResultSummary;
}

/**
 * One image block extracted from a tool_result content array.
 *
 * The bridge transports the base-64 payload + media-type straight
 * through; the web client constructs a `data:<mediaType>;base64,<dataB64>`
 * URL for the `<img>` `src` attribute. No blob URLs, no server route —
 * see Design ADR-006.
 */
export interface ToolResultImage {
  /** MIME type, e.g. `"image/png"`, `"image/jpeg"`. */
  mediaType: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  dataB64: string;
  /** Optional alt text (currently unused — reserved for future MCP tools that surface captions). */
  alt?: string;
}

export interface ToolResultSummary {
  /** Joined text from result blocks; truncated by the bridge to keep payloads small. */
  text: string;
  isError: boolean;
  /**
   * Optional image blocks extracted from the SDK's tool_result content
   * array. Absent when the tool_result had no image blocks (legacy
   * back-compat). See ADR-007.
   */
  images?: ToolResultImage[];
}

export type AssistantBlock = AssistantTextBlock | AssistantThinkingBlock | AssistantToolUseBlock;

export interface UserMessageItem {
  kind: "user-message";
  id: ChatItemId;
  turnId: TurnId;
  text: string;
  createdAt: string;
}

export interface AssistantMessageItem {
  kind: "assistant-message";
  id: ChatItemId;
  turnId: TurnId;
  blocks: AssistantBlock[];
  /** True until the SDK emits the matching `result` message (or stream ends). */
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
}

/** System-emitted info / error line (e.g. "Resumed session", "Spawn failed"). */
export interface SystemNoticeItem {
  kind: "system-notice";
  id: ChatItemId;
  text: string;
  level: "info" | "error";
  createdAt: string;
}

/**
 * US-003. Chat-level interactive plan proposal.
 *
 * Emitted by the bridge when Claude calls the `ExitPlanMode` tool while
 * the SDK is in `plan` permission mode. The plan body lives in
 * `planText` (markdown); `status` tracks the lifecycle:
 *   - `pending`   — initial state when the bridge first observes the
 *                   tool_use; the `ProposedPlanCard` renders Accept/
 *                   Reject buttons.
 *   - `accepted`  — set after `acceptPlanProposal` runs
 *                   (`setPermissionMode("default")` + queued user-turn).
 *   - `rejected`  — set after `rejectPlanProposal` runs (queued
 *                   reconsider user-turn; permission mode left at "plan").
 *
 * The card stays visible in the timeline post-decision as an audit row
 * with greyed-out controls (Design `## Plan-proposed lifecycle`).
 * Per ADR-001 the chat-level card operates independently of loom's
 * orchestration-level Plan phase — no feed-back, no hiding.
 */
export interface PlanProposedItem {
  kind: "plan-proposed";
  id: ChatItemId;
  /** Unix ms timestamp of when the bridge first observed the tool_use. */
  ts: number;
  /** Plan body extracted from the SDK's `ExitPlanMode` tool_use `input.plan`. */
  planText: string;
  /** Lifecycle. */
  status: "pending" | "accepted" | "rejected";
}

export type ChatItem =
  | UserMessageItem
  | AssistantMessageItem
  | SystemNoticeItem
  | PlanProposedItem;

export type TurnState = "idle" | "running" | "interrupted" | "error";

export interface PendingPermission {
  /** Stable id for the permission request — used by the response frame. */
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Bridge-provided prompt sentence (e.g. "Claude wants to read foo.txt"). */
  title?: string;
  /** Short noun phrase (e.g. "Read file"). */
  displayName?: string;
  /** Subtitle / reasoning. */
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
}

/**
 * One row in the TodoWrite task list, mirrored across server + web.
 *
 * Derived from the most recent `TodoWrite` tool_use input. Lifted to a
 * shared type so the `tasks-update` frame can be typed end-to-end (see
 * `frames.ts` `TasksUpdateFrame`). The shape exactly matches the web
 * mirror in `apps/web/src/lib/chat-types.ts`.
 */
export interface Task {
  step: string;
  status: "pending" | "inProgress" | "completed";
  activeForm?: string;
}
