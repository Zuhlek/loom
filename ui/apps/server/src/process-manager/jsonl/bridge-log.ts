/**
 * jsonl/bridge-log.ts — structured per-stage logging for the
 * JsonlTailBridge pipeline.
 *
 * Addresses `quality-review.md` m6 (Build rework #3): with no
 * per-stage logs, M6-class return-path defects are impossible to
 * diagnose without rerunning the server under instrumentation.
 *
 * Levels (priority ascending):
 *   - `silent` — emits nothing.
 *   - `info`   — one line per attach / detach / first-emit per chat.
 *   - `trace`  — also per-line, per-event, per-frame.
 *
 * Level is read from `process.env.LOOM_LOG_BRIDGE` at construction
 * time; defaults to `info`. Tests inject a sink-recorder log to
 * assert behaviour.
 */

export type BridgeLogLevel = "silent" | "info" | "trace";

export interface BridgeLogEvent {
  stage:
    | "bridge:attach"
    | "bridge:detach"
    | "bridge:emit-first"
    | "bridge:emit"
    | "tail:line"
    | "translator:event";
  chatId: string;
  data: Record<string, unknown>;
}

export interface BridgeLog {
  level: BridgeLogLevel;
  attach(chatId: string, data: Record<string, unknown>): void;
  detach(chatId: string, data: Record<string, unknown>): void;
  emitFirst(chatId: string, data: Record<string, unknown>): void;
  emit(chatId: string, data: Record<string, unknown>): void;
  tailLine(chatId: string, data: Record<string, unknown>): void;
  translatorEvent(chatId: string, data: Record<string, unknown>): void;
}

export interface BridgeLogOptions {
  level?: BridgeLogLevel;
  /**
   * Sink for emitted lines. Defaults to `console.log` (one line per
   * event, stable shape). Tests inject a recorder.
   */
  sink?: (event: BridgeLogEvent) => void;
}

function parseLevel(raw: string | undefined): BridgeLogLevel {
  if (raw === "silent") return "silent";
  if (raw === "trace") return "trace";
  if (raw === "info") return "info";
  // Auto-silent inside vitest unless the env var explicitly opts in.
  // Tests that want to assert log output inject a sink recorder via
  // `createBridgeLog({ level, sink })`; the bridge default should not
  // spam stdout in the suite.
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return "silent";
  }
  return "info"; // default
}

function shouldLog(level: BridgeLogLevel, stage: BridgeLogEvent["stage"]): boolean {
  if (level === "silent") return false;
  if (level === "trace") return true;
  // info: attach/detach/emit-first only
  return (
    stage === "bridge:attach" ||
    stage === "bridge:detach" ||
    stage === "bridge:emit-first"
  );
}

function defaultSink(event: BridgeLogEvent): void {
  const parts: string[] = [`[${event.stage}]`, `chatId=${event.chatId}`];
  for (const [k, v] of Object.entries(event.data)) {
    parts.push(`${k}=${formatValue(v)}`);
  }
  // Single-line output by design (m6: tail-friendly).
  // eslint-disable-next-line no-console
  console.log(parts.join(" "));
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    // Quote if it contains whitespace; otherwise emit bare.
    return /\s/.test(v) ? JSON.stringify(v) : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function createBridgeLog(opts: BridgeLogOptions = {}): BridgeLog {
  const level = opts.level ?? parseLevel(process.env.LOOM_LOG_BRIDGE);
  const sink = opts.sink ?? defaultSink;

  function maybeEmit(stage: BridgeLogEvent["stage"], chatId: string, data: Record<string, unknown>): void {
    if (!shouldLog(level, stage)) return;
    sink({ stage, chatId, data });
  }

  return {
    level,
    attach(chatId, data) {
      maybeEmit("bridge:attach", chatId, data);
    },
    detach(chatId, data) {
      maybeEmit("bridge:detach", chatId, data);
    },
    emitFirst(chatId, data) {
      maybeEmit("bridge:emit-first", chatId, data);
    },
    emit(chatId, data) {
      maybeEmit("bridge:emit", chatId, data);
    },
    tailLine(chatId, data) {
      maybeEmit("tail:line", chatId, data);
    },
    translatorEvent(chatId, data) {
      maybeEmit("translator:event", chatId, data);
    },
  };
}
