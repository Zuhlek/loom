import { translate, type TranslatorCtx } from "../../src/process-manager/jsonl/translator.ts";
import type { ClaudeEvent } from "../../src/process-manager/jsonl/schema.ts";

/** Translate an iterable of raw lines, skipping nulls — test convenience. */
export function translateMany(lines: Iterable<string>, ctx: TranslatorCtx): ClaudeEvent[] {
  const out: ClaudeEvent[] = [];
  for (const l of lines) {
    const ev = translate(l, ctx);
    if (ev !== null) out.push(ev);
  }
  return out;
}
