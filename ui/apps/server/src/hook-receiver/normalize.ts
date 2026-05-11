/**
 * Normalize Claude Code hook events into chat-protocol envelopes.
 *
 * Hook channels supported (per seed):
 *   PostToolUse, SessionStart, Stop, SubagentStop,
 *   PermissionRequest, plus generic tool-use channels.
 *
 * For PermissionRequest and AskUserQuestion-bearing PostToolUse,
 * a PendingGate row is the side-effect (handled in index.ts).
 */
import type { ChatEnvelope } from "../chat-protocol/envelope.ts";
import { makeEnvelope } from "../chat-protocol/envelope.ts";

export type HookChannel =
  | "PostToolUse"
  | "PreToolUse"
  | "SessionStart"
  | "Stop"
  | "SubagentStop"
  | "PermissionRequest"
  | "Notification"
  | string; // forward-compat

export interface HookEvent {
  channel: HookChannel;
  chatId?: string;
  sessionId?: string;
  toolName?: string;
  toolArgs?: unknown;
  payload?: any; // raw body
}

export interface NormalizeResult {
  envelopes: ChatEnvelope[];
  pendingGate?: {
    chatId: string;
    kind: "askuserquestion" | "permissionrequest";
    data: any;
  };
  clearGates?: { chatId: string }; // for Stop / SubagentStop
  warning?: string;
}

export function normalizeHookEvent(ev: HookEvent): NormalizeResult {
  const chatId = ev.chatId ?? "";
  switch (ev.channel) {
    case "SessionStart":
      return {
        envelopes: [makeEnvelope("session-start", chatId, { sessionId: ev.sessionId })],
      };
    case "Stop":
    case "SubagentStop":
      return {
        envelopes: [makeEnvelope("stop", chatId, { kind: ev.channel })],
        clearGates: chatId ? { chatId } : undefined,
      };
    case "PermissionRequest":
      return {
        envelopes: [makeEnvelope("gate-pending", chatId, { kind: "permissionrequest", data: ev.payload })],
        pendingGate: chatId ? { chatId, kind: "permissionrequest", data: ev.payload } : undefined,
      };
    case "PostToolUse": {
      // Claude Code emits AskUserQuestion as a PostToolUse with toolName=AskUserQuestion.
      if (ev.toolName === "AskUserQuestion") {
        return {
          envelopes: [makeEnvelope("gate-pending", chatId, { kind: "askuserquestion", data: ev.payload })],
          pendingGate: chatId ? { chatId, kind: "askuserquestion", data: ev.payload } : undefined,
        };
      }
      return {
        envelopes: [makeEnvelope("post-tool-use", chatId, { toolName: ev.toolName, payload: ev.payload })],
      };
    }
    case "PreToolUse":
      return { envelopes: [makeEnvelope("pre-tool-use", chatId, { toolName: ev.toolName, payload: ev.payload })] };
    case "Notification":
      return { envelopes: [makeEnvelope("notification", chatId, { payload: ev.payload })] };
    default:
      return {
        envelopes: [makeEnvelope("hook-passthrough", chatId, { channel: ev.channel, payload: ev.payload })],
        warning: `unknown channel: ${ev.channel}`,
      };
  }
}
