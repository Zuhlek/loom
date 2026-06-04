/**
 * Normalize Claude Code hook events into chat-protocol envelopes.
 *
 * Two input shapes are accepted:
 *
 * 1. The real Claude Code hook payload (POSTed by claude's hook curl shim):
 *      { hook_event_name, session_id, tool_name, tool_input,
 *        tool_response, cwd, transcript_path, message? }
 *    `hook_event_name` is one of PreToolUse, PostToolUse, Notification,
 *    SessionStart, Stop, SubagentStop, PreCompact, SessionEnd, ...
 *
 * 2. The legacy loom shape used by older tests:
 *      { channel, chatId, sessionId, toolName, toolArgs, payload }
 *    Kept for back-compat — existing fixture tests still pass without
 *    rewriting every call site.
 *
 * Per-channel side-effects:
 *   - PreToolUse(AskUserQuestion) → gate-pending {kind: "askuserquestion"}.
 *     This is the *only* place AskUserQuestion is intercepted; the
 *     previous PostToolUse arm has been removed because PostToolUse
 *     fires AFTER the user already answered in the TUI (too late).
 *   - PreToolUse(<permission tool>) → pre-tool-use envelope (bridge then
 *     emits pending-permission). Only tools in PERMISSION_TOOLS qualify;
 *     read-only tools (Read, Grep, Glob, ...) are dropped silently.
 *   - PostToolUse → passthrough envelope.
 *   - Stop / SubagentStop → clear pending gates for this chat.
 *   - Notification → notification envelope (no gating).
 *   - SessionStart → session-start envelope.
 *   - Anything else → hook-passthrough + warning.
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

/**
 * Tools whose PreToolUse invocation should surface a permission popup.
 * Read-only tools (Read, Grep, Glob, LS, ...) and TodoWrite never gate.
 * `AskUserQuestion` is handled separately (it is a question, not a perm).
 */
export const PERMISSION_TOOLS = new Set<string>([
  "Edit",
  "Write",
  "Bash",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
]);

/**
 * The subset of {@link PERMISSION_TOOLS} that `acceptEdits` mode auto-accepts.
 * In `acceptEdits` claude approves file mutations without prompting, so loom
 * must NOT pop a gate for these (it would override the user's chosen mode);
 * Bash / WebFetch still gate. See {@link shouldGatePreToolUse}.
 */
const EDIT_FAMILY_TOOLS = new Set<string>([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/**
 * Whether a PreToolUse for `toolName` under `permissionMode` should hold the
 * agent behind a loom popup. Mirrors claude's own gating so the popup never
 * contradicts the active mode:
 *   - `bypassPermissions` → never gate (the whole point of bypass).
 *   - `plan`              → never gate (plan mode blocks mutations itself).
 *   - `acceptEdits`       → gate everything EXCEPT auto-accepted file edits.
 *   - `default` (or any   → gate every permission tool.
 *     unknown mode)
 * Non-permission tools never gate (handled by the PERMISSION_TOOLS check).
 */
export function shouldGatePreToolUse(
  toolName: string,
  permissionMode: string | undefined,
): boolean {
  if (permissionMode === "bypassPermissions" || permissionMode === "plan") {
    return false;
  }
  if (permissionMode === "acceptEdits" && EDIT_FAMILY_TOOLS.has(toolName)) {
    return false;
  }
  return true;
}

export interface ClaudeHookEvent {
  // Real Claude Code shape:
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  cwd?: string;
  transcript_path?: string;
  /** Notification carries this. */
  message?: string;
  /** Active permission mode at hook time (default/acceptEdits/plan/bypassPermissions/...). */
  permission_mode?: string;
  // Legacy loom shape (kept for existing tests):
  channel?: string;
  chatId?: string;
  sessionId?: string;
  toolName?: string;
  toolArgs?: unknown;
  payload?: unknown;
}

/**
 * Back-compat type alias — older callers / tests refer to this name.
 */
export type HookEvent = ClaudeHookEvent;

export interface NormalizeResult {
  envelopes: ChatEnvelope[];
  pendingGate?: {
    chatId: string;
    kind: "askuserquestion" | "permissionrequest";
    data: any;
  };
  /**
   * Set when this event must BLOCK the agent behind a loom popup. The
   * receiver registers a {@link PermissionGate} under `{chatId, id}`, holds
   * the hook's HTTP response open until the UI answers, then returns the
   * resulting `permissionDecision` to claude. `id` is identical to the
   * pre-tool-use envelope's `payload.id` so the WS `permission-response`
   * (keyed on the same id) resolves the right gate.
   */
  gate?: { chatId: string; id: string };
  clearGates?: { chatId: string }; // for Stop / SubagentStop
  warning?: string;
}

interface NormalizedOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * Best-effort normalisation of an AskUserQuestion `tool_input` into
 * `{question, options[], multiSelect}`. The TUI is index-driven (the
 * user types "1", "2", ...) so we synthesise stable ids `opt-1`,
 * `opt-2`, ... in array order regardless of the inbound option shape.
 *
 * Real Claude Code sends the plural shape:
 *   { questions: [{ question, header, options, multiSelect }] }
 * The singular `{question, options, multiSelect}` shape is kept as a
 * fallback for back-compat with legacy fixtures.
 *
 * Accepts options as:
 *   - string[]                       (rare; treat each as both id+label)
 *   - {label, description?}[]        (typical Claude shape)
 *   - {id, label, description?}[]    (already-normalised — id is ignored;
 *                                     we re-synthesise to preserve index)
 */
function normaliseQuestionInput(input: Record<string, unknown> | undefined): {
  question: string;
  options: NormalizedOption[];
  multiSelect: boolean;
} {
  const src = input ?? {};
  // Unwrap the plural `questions: [...]` shape to its first element before
  // applying the singular logic. Claude Code currently only ever sends one
  // question per AskUserQuestion call.
  const inner: Record<string, unknown> =
    Array.isArray(src.questions) &&
    src.questions.length > 0 &&
    typeof src.questions[0] === "object" &&
    src.questions[0] !== null
      ? (src.questions[0] as Record<string, unknown>)
      : src;
  const question = typeof inner.question === "string" ? inner.question : "";
  const rawOptions = Array.isArray(inner.options) ? inner.options : [];
  const options: NormalizedOption[] = rawOptions.map((o, i) => {
    const idx = i + 1;
    const synthId = `opt-${idx}`;
    if (typeof o === "string") {
      return { id: synthId, label: o };
    }
    if (o && typeof o === "object") {
      const obj = o as Record<string, unknown>;
      const label = typeof obj.label === "string"
        ? obj.label
        : typeof obj.name === "string"
          ? obj.name
          : String(idx);
      const description = typeof obj.description === "string" ? obj.description : undefined;
      return { id: synthId, label, description };
    }
    return { id: synthId, label: String(idx) };
  });
  const multiSelect = inner.multiSelect === true;
  return { question, options, multiSelect };
}

export function normalizeHookEvent(ev: ClaudeHookEvent, chatId?: string): NormalizeResult {
  // Translate Claude-shape → loom-shape, but keep legacy fields as fallback.
  const channel = ev.hook_event_name ?? ev.channel ?? "";
  const toolName = ev.tool_name ?? ev.toolName;
  const payload =
    ev.tool_input !== undefined
      ? ev.tool_input
      : (ev.payload as Record<string, unknown> | undefined);
  const resolvedChatId = chatId ?? ev.chatId ?? "";
  const sessionId = ev.session_id ?? ev.sessionId;
  const permissionMode = ev.permission_mode;

  switch (channel) {
    case "SessionStart":
      return {
        envelopes: [makeEnvelope("session-start", resolvedChatId, { sessionId })],
      };

    case "Stop":
    case "SubagentStop":
      return {
        envelopes: [makeEnvelope("stop", resolvedChatId, { kind: channel })],
        clearGates: resolvedChatId ? { chatId: resolvedChatId } : undefined,
      };

    case "PermissionRequest": {
      // Legacy synthetic channel — kept for back-compat with old fixtures.
      // Real Claude Code does not emit this; an orphan hook entry on disk
      // can still deliver empty payloads to this path, which we drop to
      // avoid rendering empty permission popups.
      const isEmpty =
        payload === undefined ||
        (typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload) &&
          Object.keys(payload as Record<string, unknown>).length === 0);
      if (isEmpty) return { envelopes: [] };
      return {
        envelopes: [
          makeEnvelope("gate-pending", resolvedChatId, {
            kind: "permissionrequest",
            data: payload,
          }),
        ],
        pendingGate: resolvedChatId
          ? { chatId: resolvedChatId, kind: "permissionrequest", data: payload }
          : undefined,
      };
    }

    case "PreToolUse": {
      if (toolName === "AskUserQuestion") {
        const input = (payload ?? {}) as Record<string, unknown>;
        const { question, options, multiSelect } = normaliseQuestionInput(input);
        // Stable-ish id: chatId + question text hash; fallback to timestamp.
        const id = resolvedChatId
          ? `q-${resolvedChatId}-${simpleHash(question)}`
          : `q-${Date.now()}`;
        const data = { id, question, options, multiSelect };
        return {
          envelopes: [
            makeEnvelope("gate-pending", resolvedChatId, {
              kind: "askuserquestion",
              data,
            }),
          ],
          pendingGate: resolvedChatId
            ? { chatId: resolvedChatId, kind: "askuserquestion", data }
            : undefined,
          // Hold the agent at the hook until the UI answers. Unlike a
          // permission gate, the gate decision here is only a HOLD: the bridge
          // resolves it with `defer` (so claude renders its question widget,
          // which the bridge then drives via keystrokes) or it auto-denies on
          // timeout. The chosen option itself travels via those keystrokes,
          // keyed on this same id. Asked in every mode — even bypass — since a
          // question is not a permission.
          gate: resolvedChatId ? { chatId: resolvedChatId, id } : undefined,
        };
      }
      if (toolName && PERMISSION_TOOLS.has(toolName)) {
        // Honour the active permission mode: bypass/plan/acceptEdits-edits
        // are auto-handled by claude, so popping a gate there would contradict
        // the user's chosen mode. Drop silently — claude proceeds on its own.
        if (!shouldGatePreToolUse(toolName, permissionMode)) {
          return { envelopes: [] };
        }
        const input = (payload ?? {}) as Record<string, unknown>;
        // Preserve any legacy `id` the caller may have stuffed in; otherwise
        // synthesise so the bridge's PendingPermission keying works. This id
        // is also the gate key the WS `permission-response` resolves against.
        const existingId =
          typeof (input as { id?: unknown }).id === "string"
            ? ((input as { id: string }).id)
            : undefined;
        const id = existingId ?? `perm-${Date.now()}`;
        return {
          envelopes: [
            makeEnvelope("pre-tool-use", resolvedChatId, {
              toolName,
              payload: {
                id,
                toolName,
                input,
                displayName: toolName,
                toolUseId:
                  typeof (input as { toolUseId?: unknown }).toolUseId === "string"
                    ? ((input as { toolUseId: string }).toolUseId)
                    : undefined,
              },
            }),
          ],
          gate: resolvedChatId ? { chatId: resolvedChatId, id } : undefined,
        };
      }
      // Read-only / non-gated tool: drop silently to avoid popup spam.
      return { envelopes: [] };
    }

    case "PostToolUse":
      // AskUserQuestion is now intercepted at PreToolUse — see above.
      // PostToolUse for anything is a plain passthrough.
      return {
        envelopes: [
          makeEnvelope("post-tool-use", resolvedChatId, {
            toolName,
            payload,
          }),
        ],
      };

    case "Notification":
      return {
        envelopes: [
          makeEnvelope("notification", resolvedChatId, {
            payload: payload ?? { message: ev.message },
          }),
        ],
      };

    default:
      return {
        envelopes: [
          makeEnvelope("hook-passthrough", resolvedChatId, {
            channel,
            payload,
          }),
        ],
        warning: `unknown channel: ${channel}`,
      };
  }
}

/** Tiny non-crypto hash for synthesising stable question ids. */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
