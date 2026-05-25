/**
 * T-004 — jsonl/translator.ts unit + golden-file tests.
 *
 * The translator is a pure function: `(rawLine, ctx) → ClaudeEvent`.
 * It composes `schema.parseLine(...)` and stamps the schema version.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  translate,
  translateMany,
  type TranslatorCtx,
} from "../src/process-manager/jsonl/translator.ts";
import { CURRENT_SCHEMA_VERSION } from "../src/process-manager/jsonl/schema.ts";

const ctx: TranslatorCtx = { chatId: "c-1", sessionId: "s-1" };

const FIXTURE_DIR = join(__dirname, "fixtures", "jsonl");
const SNAPSHOT_DIR = join(__dirname, "snapshots", "translator");

function listFixtures(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((n) => n.endsWith(".jsonl"))
    .sort();
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

describe("jsonl/translator — unit", () => {
  it("stamps every output event with CURRENT_SCHEMA_VERSION", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "e-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    });
    const ev = translate(line, ctx);
    expect(ev).not.toBeNull();
    expect(ev!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("is pure: same input → deep-equal output across two calls", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "e-2",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      },
    });
    const a = translate(line, ctx);
    const b = translate(line, ctx);
    expect(a).toEqual(b);
  });

  it("preserves provenance: chatId + sessionId from ctx land on the output event", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "e-3",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "x" },
    });
    const ev = translate(line, { chatId: "chat-A", sessionId: "sess-A" });
    expect(ev?.chatId).toBe("chat-A");
    expect(ev?.sessionId).toBe("sess-A");
  });

  it("preserves the input type on kind=unknown via rawKind", () => {
    const line = JSON.stringify({
      type: "definitely-not-real",
      uuid: "e-4",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const ev = translate(line, ctx);
    expect(ev?.kind).toBe("unknown");
    if (ev?.kind === "unknown") {
      expect(ev.rawKind).toBe("definitely-not-real");
    }
  });

  it("returns null on malformed JSON instead of throwing", () => {
    const ev = translate("{not-json", ctx);
    expect(ev).toBeNull();
  });

  it("returns null on blank or whitespace-only lines", () => {
    expect(translate("", ctx)).toBeNull();
    expect(translate("   ", ctx)).toBeNull();
  });

  it("deterministic synthetic id varies with chatId (hash domain coverage)", () => {
    // Same raw line, different ctx → ids must differ. This proves the hash
    // domain includes chatId/sessionId, not just the line text.
    const line = JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "hello-no-uuid" },
    });
    const a = translate(line, { chatId: "chat-A", sessionId: "s" });
    const b = translate(line, { chatId: "chat-B", sessionId: "s" });
    expect(a?.id).toMatch(/^synthetic-/);
    expect(b?.id).toMatch(/^synthetic-/);
    expect(a?.id).not.toBe(b?.id);
  });

  it("absorbs loom-instrumentation hook attachment events as kind=unknown", () => {
    // Hook receiver may POST back loom:hook_success / hook_non_blocking_error
    // attachment events into the transcript. They are NOT native claude events.
    const line = JSON.stringify({
      type: "loom:hook_success",
      uuid: "e-loom-1",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const ev = translate(line, ctx);
    expect(ev?.kind).toBe("unknown");
  });

  it("translateMany skips null lines and returns aligned ClaudeEvent[]", () => {
    const lines = [
      JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "a" } }),
      "{broken",
      JSON.stringify({ type: "user", uuid: "u2", message: { role: "user", content: "b" } }),
      "",
    ];
    const events = translateMany(lines, ctx);
    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBe("u1");
    expect(events[1]?.id).toBe("u2");
  });
});

describe("jsonl/translator — golden snapshots", () => {
  const fixtures = listFixtures();
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  for (const fx of fixtures) {
    it(`fixture: ${fx} produces a deterministic event sequence`, () => {
      const lines = readLines(join(FIXTURE_DIR, fx));
      const fxCtx: TranslatorCtx = {
        chatId: `chat-${fx}`,
        sessionId: `session-${fx}`,
      };
      const events = translateMany(lines, fxCtx);

      // Pure-function determinism: rerunning yields deep-equal output.
      const again = translateMany(lines, fxCtx);
      expect(again).toEqual(events);

      // Every event carries the schema version stamp.
      for (const ev of events) {
        expect(ev.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }

      // Snapshot stability: write on first run, then assert equality.
      const snapPath = join(SNAPSHOT_DIR, `${fx}.json`);
      const serialised = JSON.stringify(events, null, 2);
      if (!existsSync(snapPath)) {
        writeFileSync(snapPath, serialised, "utf8");
      } else {
        const expected = readFileSync(snapPath, "utf8");
        expect(serialised).toBe(expected);
      }
    });
  }
});
