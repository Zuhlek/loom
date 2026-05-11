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

export interface ToolResultSummary {
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

export type ChatItem = UserMessageItem | AssistantMessageItem | SystemNoticeItem;

export type TurnState = "idle" | "running" | "interrupted" | "error";

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
  | { kind: "error"; "chat-id"?: string; body: { message: string } };

export type ClientFrame =
  | { kind: "attach"; "chat-id": string }
  | { kind: "detach"; "chat-id": string }
  | { kind: "user-turn"; "chat-id": string; body: { text: string } }
  | { kind: "interrupt"; "chat-id": string }
  | {
      kind: "permission-response";
      "chat-id": string;
      body: { id: string; behavior: "allow" | "deny"; remember?: boolean; message?: string };
    }
  | {
      kind: "question-response";
      "chat-id": string;
      body: { id: string; choice: string; freeform?: string };
    };

export interface Task {
  step: string;
  status: "pending" | "inProgress" | "completed";
  activeForm?: string;
}
