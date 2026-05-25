/**
 * trace.ts — diagnostic logger for the hook delivery path.
 *
 * Gated on `LOOM_TRACE_HOOKS=1`; harmless no-op when unset. Emits one
 * `console.warn` line per call in the form
 *   `[loom hook trace] <label> key=value key=value ... body=<json>`
 * where `body` (if present) is truncated to 2000 chars so a giant
 * tool_input doesn't blow up the terminal.
 *
 * Used by `hook-receiver/index.ts` ("inbound") and
 * `process-manager/jsonl/bridge.ts#routeHookEnvelope` ("route") to
 * follow an event from HTTP ingest to bridge dispatch.
 */

const BODY_TRUNCATE_CHARS = 2000;

export function traceHook(label: string, fields: Record<string, unknown>): void {
  if (process.env.LOOM_TRACE_HOOKS !== "1") return;
  const parts: string[] = [`[loom hook trace] ${label}`];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "body") {
      parts.push(
        `body=${JSON.stringify(value ?? null).slice(0, BODY_TRUNCATE_CHARS)}`,
      );
    } else {
      parts.push(`${key}=${value ?? ""}`);
    }
  }
  console.warn(parts.join(" "));
}
