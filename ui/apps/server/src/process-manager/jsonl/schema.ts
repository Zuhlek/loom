/**
 * jsonl/schema.ts — sole owner of JSONL on-disk field-name string literals.
 *
 * Every JSONL field-name string literal lives in `FIELDS_V1`. No other
 * module under `process-manager/jsonl/` may inline a JSONL field-name
 * literal; a CI grep test enforces this structurally.
 *
 * The module exports the `ClaudeEvent` discriminated union, the
 * `CURRENT_SCHEMA_VERSION` stamp, the `parserFor` selector, and the
 * `parseLine` convenience entry point.
 */

import { randomUUID } from "node:crypto";

import type {
  SessionLifecycle,
  WireSlashCommand,
} from "../../chat-protocol/messages.ts";

/** Bumped any time the on-disk format changes in a way the parser cares about. */
export const CURRENT_SCHEMA_VERSION = "v1" as const;
export type SchemaVersion = "v1";

/**
 * Field-name table. The only place JSONL field-name string literals
 * appear in the codebase. Other modules access JSONL fields exclusively
 * through `parseLine` / `parserFor` — never via direct
 * `JSON.parse(line).foo.bar` access (enforced by a CI grep test).
 */
export const FIELDS_V1 = {
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
} as const;

/** Pretty alias of `FIELDS_V1` values, for documentation purposes. */
export type FieldName = (typeof FIELDS_V1)[keyof typeof FIELDS_V1];

/** Context-usage snapshot. Mirror of the existing SDK bridge payload. */
export interface ContextUsageSnapshot {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
  model: string;
}

/**
 * The discriminated union the translator emits. Every variant carries:
 *   - `id`: the JSONL event id (dedupe key for the materializer)
 *   - `schemaVersion`: the parser version this event was parsed under
 *   - `chatId` / `sessionId`: provenance
 *   - `tsIso`: wall-clock from the JSONL record
 */
export type ClaudeEvent =
  | {
      kind: "text";
      id: string;
      schemaVersion: SchemaVersion;
      chatId: string;
      sessionId: string;
      tsIso: string;
      role: "user" | "assistant";
      text: string;
    }
  | {
      kind: "tool_use";
      id: string;
      schemaVersion: SchemaVersion;
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
      schemaVersion: SchemaVersion;
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
      schemaVersion: SchemaVersion;
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
      schemaVersion: SchemaVersion;
      chatId: string;
      sessionId: string;
      tsIso: string;
      lifecycle: SessionLifecycle;
    }
  | {
      kind: "slash_command_set";
      id: string;
      schemaVersion: SchemaVersion;
      chatId: string;
      sessionId: string;
      tsIso: string;
      commands: WireSlashCommand[];
    }
  | {
      kind: "context_usage";
      id: string;
      schemaVersion: SchemaVersion;
      chatId: string;
      sessionId: string;
      tsIso: string;
      usage: ContextUsageSnapshot;
    }
  | {
      kind: "unknown";
      id: string;
      schemaVersion: SchemaVersion;
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
 * Read a field by its `FIELDS_V1` name without using a literal at the
 * call site. Centralises the only place field-name strings flow.
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
  return asString(field(obj, FIELDS_V1.TIMESTAMP)) ?? "";
}

/** Best-effort id extraction; synthesises one if absent. */
function readId(obj: unknown): string {
  return asString(field(obj, FIELDS_V1.UUID)) ?? synthesiseId();
}

/** Reduce the raw `message.content` to a plain text string. */
function reduceContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const t = asString(field(block, FIELDS_V1.TYPE));
    if (t === "text") {
      const txt = asString(field(block, FIELDS_V1.TEXT));
      if (txt) parts.push(txt);
    }
  }
  return parts.join("");
}

/** Pull the first content block of a given type out of `message.content`. */
function findContentBlock(content: unknown, blockType: string): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const t = asString(field(block, FIELDS_V1.TYPE));
    if (t === blockType) return block as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Coerce a `Task*` family tool_use into the variant-field subset the
 * `task_update` `ClaudeEvent` carries. Returns `undefined` when the
 * tool name is outside the family or when `TaskUpdate.input.status`
 * carries a value outside the v1 vocabulary (forces the caller to
 * fall through to the generic `tool_use` arm per Design § State and
 * error handling).
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
      asString(field(input, FIELDS_V1.SUBJECT)) ??
      asString(field(input, FIELDS_V1.DESCRIPTION));
    const activeForm = asString(field(input, FIELDS_V1.ACTIVE_FORM));
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
    const taskId = asString(field(input, FIELDS_V1.TASK_ID));
    const rawStatus = asString(field(input, FIELDS_V1.STATUS));
    let status: "pending" | "inProgress" | "completed" | undefined;
    if (rawStatus === "in_progress" || rawStatus === "inProgress") {
      status = "inProgress";
    } else if (rawStatus === "pending" || rawStatus === "completed") {
      status = rawStatus;
    } else if (rawStatus !== undefined) {
      // Unknown status — defensive default: refuse the task_update arm so
      // the parser falls through to the generic tool_use shape.
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

function parseV1(raw: unknown, ctx: ParseCtx): ClaudeEvent {
  const id = readId(raw);
  const tsIso = readTs(raw);
  const rawType = asString(field(raw, FIELDS_V1.TYPE)) ?? "";
  const base = {
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    chatId: ctx.chatId,
    sessionId: ctx.sessionId,
    tsIso,
  } as const;

  const message = field<Record<string, unknown>>(raw, FIELDS_V1.MESSAGE);
  const role = message ? asString(field(message, FIELDS_V1.ROLE)) : undefined;
  const content = message ? field(message, FIELDS_V1.CONTENT) : undefined;

  // user / assistant lines carry the message envelope; their semantics are
  // distinguished by the content blocks within `message.content`.
  if (rawType === "user" || rawType === "assistant") {
    // tool_use block (assistant)
    if (rawType === "assistant") {
      const toolUseBlock = findContentBlock(content, "tool_use");
      if (toolUseBlock) {
        const toolName = asString(field(toolUseBlock, FIELDS_V1.TOOL_NAME)) ?? "";
        const toolUseId = asString(field(toolUseBlock, FIELDS_V1.ID)) ?? "";
        const input = field(toolUseBlock, FIELDS_V1.INPUT);
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
        const toolUseId = asString(field(toolResultBlock, FIELDS_V1.TOOL_USE_ID)) ?? "";
        const isError = field(toolResultBlock, FIELDS_V1.IS_ERROR) === true;
        const output = field(toolResultBlock, FIELDS_V1.CONTENT);
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
    const r: "user" | "assistant" = rawType === "assistant" ? "assistant" : "user";
    return {
      ...base,
      kind: "text",
      role: r,
      text,
    };
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

/** Parser-version selector. */
export function parserFor(
  v: SchemaVersion,
): (raw: unknown, ctx: ParseCtx) => ClaudeEvent {
  if (v === "v1") return parseV1;
  throw new Error(`schema: unsupported parser version: ${String(v)}`);
}

/**
 * Convenience entry point. Throws on unparseable JSON; returns a
 * `kind: "unknown"` event for recognised JSON whose `type` field is
 * outside the v1 vocabulary.
 */
export function parseLine(
  raw: string,
  ctx: ParseCtx,
  version: SchemaVersion = CURRENT_SCHEMA_VERSION,
): ClaudeEvent {
  const parsed = JSON.parse(raw);
  const fn = parserFor(version);
  return fn(parsed, ctx);
}

/**
 * Extract the inner `sessionId` field from a single JSONL line. Returns
 * `null` when the line cannot be parsed as JSON or the field is absent
 * / not a string. This is the only sanctioned path for callers that
 * need to discriminate JSONL files by their inner session-id (e.g. the
 * active-JSONL discovery used at bridge attach time), keeping the
 * field-name discipline grep green.
 */
export function readSessionIdFromLine(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const v = field(parsed, FIELDS_V1.SESSION_ID);
  return asString(v) ?? null;
}
