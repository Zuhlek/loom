/**
 * jsonl/schema.ts — sole owner of JSONL on-disk field-name string literals.
 *
 * Every JSONL field-name string literal lives in `FIELDS`. No other module
 * under `process-manager/jsonl/` may inline a JSONL field-name literal; a CI
 * grep test enforces this structurally.
 *
 * The module exports the `ClaudeEvent` discriminated union and the `parseLine`
 * entry point.
 */

import { randomUUID } from "node:crypto";

import type {
  SessionLifecycle,
  WireSlashCommand,
} from "../../chat-protocol/messages.ts";

/**
 * Field-name table. The only place JSONL field-name string literals appear in
 * the codebase. Other modules access JSONL fields exclusively through
 * `parseLine` — never via direct `JSON.parse(line).foo.bar` access (enforced
 * by a CI grep test).
 */
export const FIELDS = {
  TYPE: "type",
  UUID: "uuid",
  SESSION_ID: "sessionId",
  TIMESTAMP: "timestamp",
  MESSAGE: "message",
  CONTENT: "content",
  ROLE: "role",
  TOOL_USE_ID: "tool_use_id",
  TOOL_NAME: "name",
  INPUT: "input",
  IS_ERROR: "is_error",
  ID: "id",
  TEXT: "text",
  STEP: "step",
  STATUS: "status",
  ACTIVE_FORM: "activeForm",
  SUBJECT: "subject",
  DESCRIPTION: "description",
  TASK_ID: "taskId",
  ATTACHMENT: "attachment",
  NAMES: "names",
  ORIGIN: "origin",
  PROMPT_SOURCE: "promptSource",
} as const;

/** Pretty alias of `FIELDS` values, for documentation purposes. */
export type FieldName = (typeof FIELDS)[keyof typeof FIELDS];

/** Context-usage snapshot carried alongside an assistant turn. */
export interface ContextUsageSnapshot {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
  model: string;
}

/**
 * The discriminated union the translator emits. Every variant carries:
 *   - `id`: the JSONL event id (dedupe key for the materializer)
 *   - `chatId` / `sessionId`: provenance
 *   - `tsIso`: wall-clock from the JSONL record
 */
export type ClaudeEvent =
  | {
      kind: "text";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      // `system` covers Claude-injected non-human turns (task-completion
      // notifications, system reminders) that ride the same `type:"user"`
      // envelope a typed turn uses — see `isSystemInjectedUser`.
      role: "user" | "assistant" | "system";
      text: string;
    }
  | {
      kind: "tool_use";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      toolName: string;
      toolUseId: string;
      input: unknown;
    }
  | {
      kind: "tool_result";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      toolUseId: string;
      ok: boolean;
      output: unknown;
    }
  | {
      kind: "task_update";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      action: "create" | "update" | "list";
      subject?: string;
      activeForm?: string;
      taskId?: string;
      status?: "pending" | "inProgress" | "completed";
    }
  | {
      kind: "session_meta";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      lifecycle: SessionLifecycle;
    }
  | {
      kind: "slash_command_set";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      commands: WireSlashCommand[];
    }
  | {
      kind: "context_usage";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      usage: ContextUsageSnapshot;
    }
  | {
      kind: "unknown";
      id: string;
      chatId: string;
      sessionId: string;
      tsIso: string;
      rawKind: string;
    };

export type ClaudeEventKind = ClaudeEvent["kind"];

/** Parse-time context (provenance not present in the JSONL record itself). */
export interface ParseCtx {
  chatId: string;
  sessionId: string;
}

/**
 * Read a field by its `FIELDS` name without using a literal at the call site.
 * Centralises the only place field-name strings flow.
 */
function field<T = unknown>(obj: unknown, name: FieldName): T | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[name] as T | undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Synthesise a stable-ish id when the JSONL record lacks the dedupe field. */
function synthesiseId(): string {
  return `synthetic-${randomUUID()}`;
}

/** Best-effort timestamp extraction; falls back to empty string. */
function readTs(obj: unknown): string {
  return asString(field(obj, FIELDS.TIMESTAMP)) ?? "";
}

/** Best-effort id extraction; synthesises one if absent. */
function readId(obj: unknown): string {
  return asString(field(obj, FIELDS.UUID)) ?? synthesiseId();
}

/** Reduce the raw `message.content` to a plain text string. */
function reduceContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const t = asString(field(block, FIELDS.TYPE));
    if (t === "text") {
      const txt = asString(field(block, FIELDS.TEXT));
      if (txt) parts.push(txt);
    }
  }
  return parts.join("");
}

/**
 * True when a `type:"user"` line is a Claude-injected (non-human) turn rather
 * than something the user typed. Injected turns carry a positive marker that a
 * human turn never has:
 *   - `origin` — an object like `{ kind: "task-notification" }`, present only
 *     on injected turns;
 *   - `promptSource: "system"` — Claude's tag for system-injected prompts
 *     (human turns use `"typed"` / `"queued"`).
 *
 * Conservative by design: with NEITHER marker the line stays a user turn, so a
 * genuine human message is never mis-hidden. Without this gate the materializer
 * folds task-notifications into a blue right-aligned user bubble — the exact
 * "internal communication rendered as my question" bug this discriminates away.
 */
function isSystemInjectedUser(raw: unknown): boolean {
  const origin = field(raw, FIELDS.ORIGIN);
  if (origin != null && typeof origin === "object") return true;
  return asString(field(raw, FIELDS.PROMPT_SOURCE)) === "system";
}

/** Pull the first content block of a given type out of `message.content`. */
function findContentBlock(content: unknown, blockType: string): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const t = asString(field(block, FIELDS.TYPE));
    if (t === blockType) return block as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Build the slash-command catalog from a `skill_listing` attachment. The
 * `names` array is authoritative for the set of skills; the `content` field
 * carries `- <name>: <description>` bullets we mine for descriptions.
 */
function reduceSkillListing(attachment: unknown): WireSlashCommand[] {
  const names = field<unknown[]>(attachment, FIELDS.NAMES);
  if (!Array.isArray(names)) return [];

  const content = asString(field(attachment, FIELDS.CONTENT)) ?? "";
  const descriptions = new Map<string, string>();
  for (const block of content.split(/\n(?=- )/)) {
    const match = /^-\s+([^:]+):\s*([\s\S]*)$/.exec(block.trim());
    if (match) descriptions.set(match[1].trim(), match[2].trim());
  }

  const commands: WireSlashCommand[] = [];
  for (const raw of names) {
    const name = asString(raw);
    if (name === undefined) continue;
    commands.push({
      name,
      description: descriptions.get(name) ?? "",
      argumentHint: "",
      kind: "skill",
    });
  }
  return commands;
}

/**
 * Coerce a `Task*` family tool_use into the variant-field subset the
 * `task_update` `ClaudeEvent` carries. Returns `undefined` when the tool name
 * is outside the family or when `TaskUpdate.input.status` carries a value
 * outside the vocabulary (forces the caller to fall through to the generic
 * `tool_use` arm).
 */
function parseTaskUpdate(
  toolName: string,
  input: unknown,
):
  | {
      action: "create" | "update" | "list";
      subject?: string;
      activeForm?: string;
      taskId?: string;
      status?: "pending" | "inProgress" | "completed";
    }
  | undefined {
  if (toolName === "TaskCreate") {
    const subject =
      asString(field(input, FIELDS.SUBJECT)) ??
      asString(field(input, FIELDS.DESCRIPTION));
    const activeForm = asString(field(input, FIELDS.ACTIVE_FORM));
    const out: {
      action: "create";
      subject?: string;
      activeForm?: string;
    } = { action: "create" };
    if (subject !== undefined) out.subject = subject;
    if (activeForm !== undefined) out.activeForm = activeForm;
    return out;
  }
  if (toolName === "TaskUpdate") {
    const taskId = asString(field(input, FIELDS.TASK_ID));
    const rawStatus = asString(field(input, FIELDS.STATUS));
    let status: "pending" | "inProgress" | "completed" | undefined;
    if (rawStatus === "in_progress" || rawStatus === "inProgress") {
      status = "inProgress";
    } else if (rawStatus === "pending" || rawStatus === "completed") {
      status = rawStatus;
    } else if (rawStatus !== undefined) {
      // Unknown status — defensive default: refuse the task_update arm so the
      // parser falls through to the generic tool_use shape.
      return undefined;
    }
    const out: {
      action: "update";
      taskId?: string;
      status?: "pending" | "inProgress" | "completed";
    } = { action: "update" };
    if (taskId !== undefined) out.taskId = taskId;
    if (status !== undefined) out.status = status;
    return out;
  }
  if (toolName === "TaskList") {
    return { action: "list" };
  }
  return undefined;
}

function parseEvent(raw: unknown, ctx: ParseCtx): ClaudeEvent {
  const id = readId(raw);
  const tsIso = readTs(raw);
  const rawType = asString(field(raw, FIELDS.TYPE)) ?? "";
  const base = {
    id,
    chatId: ctx.chatId,
    sessionId: ctx.sessionId,
    tsIso,
  } as const;

  const message = field<Record<string, unknown>>(raw, FIELDS.MESSAGE);
  const role = message ? asString(field(message, FIELDS.ROLE)) : undefined;
  const content = message ? field(message, FIELDS.CONTENT) : undefined;

  // user / assistant lines carry the message envelope; their semantics are
  // distinguished by the content blocks within `message.content`.
  if (rawType === "user" || rawType === "assistant") {
    // tool_use block (assistant)
    if (rawType === "assistant") {
      const toolUseBlock = findContentBlock(content, "tool_use");
      if (toolUseBlock) {
        const toolName = asString(field(toolUseBlock, FIELDS.TOOL_NAME)) ?? "";
        const toolUseId = asString(field(toolUseBlock, FIELDS.ID)) ?? "";
        const input = field(toolUseBlock, FIELDS.INPUT);
        const taskFields = parseTaskUpdate(toolName, input);
        if (taskFields) {
          return {
            ...base,
            kind: "task_update",
            ...taskFields,
          };
        }
        return {
          ...base,
          kind: "tool_use",
          toolName,
          toolUseId,
          input,
        };
      }
    }

    // tool_result block (user)
    if (rawType === "user") {
      const toolResultBlock = findContentBlock(content, "tool_result");
      if (toolResultBlock) {
        const toolUseId = asString(field(toolResultBlock, FIELDS.TOOL_USE_ID)) ?? "";
        const isError = field(toolResultBlock, FIELDS.IS_ERROR) === true;
        const output = field(toolResultBlock, FIELDS.CONTENT);
        return {
          ...base,
          kind: "tool_result",
          toolUseId,
          ok: !isError,
          output,
        };
      }
    }

    // Plain text user / assistant message.
    const text = reduceContentToText(content);
    let r: "user" | "assistant" | "system";
    if (rawType === "assistant") {
      r = "assistant";
    } else if (isSystemInjectedUser(raw)) {
      // Non-human user-role turn (task-notification, system reminder) — flag
      // it `system` so the materializer renders a muted notice, not a blue
      // user bubble.
      r = "system";
    } else {
      r = "user";
    }
    return {
      ...base,
      kind: "text",
      role: r,
      text,
    };
  }

  // attachment lines carry an inner `attachment` envelope; `skill_listing`
  // enumerates the available slash commands (skills).
  if (rawType === "attachment") {
    const attachment = field(raw, FIELDS.ATTACHMENT);
    if (asString(field(attachment, FIELDS.TYPE)) === "skill_listing") {
      return {
        ...base,
        kind: "slash_command_set",
        commands: reduceSkillListing(attachment),
      };
    }
  }

  if (rawType === "summary") {
    return {
      ...base,
      kind: "session_meta",
      lifecycle: "active",
    };
  }

  // Unknown — preserve provenance for downstream debugging without throwing.
  void role;
  return {
    ...base,
    kind: "unknown",
    rawKind: rawType,
  };
}

/**
 * Convenience entry point. Throws on unparseable JSON; returns a
 * `kind: "unknown"` event for recognised JSON whose `type` field is outside
 * the known vocabulary.
 */
export function parseLine(raw: string, ctx: ParseCtx): ClaudeEvent {
  return parseEvent(JSON.parse(raw), ctx);
}

/**
 * Extract the inner `sessionId` field from a single JSONL line. Returns `null`
 * when the line cannot be parsed as JSON or the field is absent / not a
 * string. This is the only sanctioned path for callers that need to
 * discriminate JSONL files by their inner session-id (e.g. the active-JSONL
 * discovery used at bridge attach time), keeping the field-name discipline
 * grep green.
 */
export function readSessionIdFromLine(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const v = field(parsed, FIELDS.SESSION_ID);
  return asString(v) ?? null;
}
