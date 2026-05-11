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

export interface ToolResultSummary {
  /** Joined text from result blocks; truncated by the bridge to keep payloads small. */
  text: string;
  isError: boolean;
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

export type ChatItem = UserMessageItem | AssistantMessageItem | SystemNoticeItem;

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
