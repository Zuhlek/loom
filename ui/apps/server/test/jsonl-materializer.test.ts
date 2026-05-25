/**
 * T-005 — jsonl/materializer.ts: per-chat folder ClaudeEvent → ChatItem[].
 * Dedupes on event id; derives `tasks-update` from `todo_write` events.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createMaterializer } from "../src/process-manager/jsonl/materializer.ts";
import { translateMany, type TranslatorCtx } from "../src/process-manager/jsonl/translator.ts";
import type { ClaudeEvent } from "../src/process-manager/jsonl/schema.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";

const ctx: TranslatorCtx = { chatId: "c-1", sessionId: "s-1" };

function ev(partial: Partial<ClaudeEvent> & { kind: ClaudeEvent["kind"]; id: string }): ClaudeEvent {
  const base = {
    schemaVersion: "v1" as const,
    chatId: "c-1",
    sessionId: "s-1",
    tsIso: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...partial } as ClaudeEvent;
}

describe("jsonl/materializer — dedupe + folding", () => {
  it("ingest of a text event emits an item-append frame", () => {
    const m = createMaterializer();
    const frames = m.ingest(
      ev({ kind: "text", id: "e1", role: "user", text: "hi" } as any),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]?.kind).toBe("item-append");
  });

  it("dedupe: feeding the same event twice yields a frame then zero frames", () => {
    const m = createMaterializer();
    const e = ev({ kind: "text", id: "e1", role: "user", text: "hi" } as any);
    const first = m.ingest(e);
    const second = m.ingest(e);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("replay idempotency: same transcript twice through one materializer yields identical snapshot", () => {
    const m = createMaterializer();
    const events: ClaudeEvent[] = [
      ev({ kind: "text", id: "e1", role: "user", text: "hi" } as any),
      ev({ kind: "text", id: "e2", role: "assistant", text: "hello" } as any),
    ];
    for (const e of events) m.ingest(e);
    const snap1 = m.snapshot();
    for (const e of events) m.ingest(e);
    const snap2 = m.snapshot();
    expect(snap2).toEqual(snap1);
  });

  it("replay idempotency: same transcript through two materializers yields deep-equal snapshots", () => {
    const a = createMaterializer();
    const b = createMaterializer();
    const events: ClaudeEvent[] = [
      ev({ kind: "text", id: "e1", role: "user", text: "hi" } as any),
      ev({ kind: "text", id: "e2", role: "assistant", text: "hello" } as any),
    ];
    for (const e of events) a.ingest(e);
    for (const e of events) b.ingest(e);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("todo_write yields a tasks-update frame matching the wire body shape", () => {
    const m = createMaterializer();
    const frames = m.ingest(
      ev({
        kind: "todo_write",
        id: "e-todo",
        tasks: [
          { step: "do thing", status: "inProgress", activeForm: "Doing thing" },
          { step: "next thing", status: "pending" },
        ],
      } as any),
    );
    const tu = frames.find((f) => f.kind === "tasks-update");
    expect(tu).toBeDefined();
    expect(tu?.kind).toBe("tasks-update");
    if (tu?.kind === "tasks-update") {
      expect(tu.body.tasks).toEqual([
        { step: "do thing", status: "inProgress", activeForm: "Doing thing" },
        { step: "next thing", status: "pending" },
      ]);
    }
  });

  it("snapshot() returns the current ChatItem[] synchronously", () => {
    const m = createMaterializer();
    m.ingest(ev({ kind: "text", id: "e1", role: "user", text: "x" } as any));
    const snap = m.snapshot();
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]?.kind).toBe("user-message");
  });

  it("reset() clears state; previously seen events emit frames again", () => {
    const m = createMaterializer();
    const e = ev({ kind: "text", id: "e1", role: "user", text: "x" } as any);
    expect(m.ingest(e)).toHaveLength(1);
    expect(m.ingest(e)).toHaveLength(0);
    m.reset();
    expect(m.snapshot().items).toHaveLength(0);
    expect(m.ingest(e)).toHaveLength(1);
  });

  it("unknown events are absorbed silently (no frames, no throw)", () => {
    const m = createMaterializer();
    const frames = m.ingest(ev({ kind: "unknown", id: "e-u", rawKind: "weird" } as any));
    expect(frames).toEqual([]);
  });

  it("frame stream and chat-id stamping: every frame carries the chatId", () => {
    const m = createMaterializer({ chatId: "the-chat" });
    const e = ev({ kind: "text", id: "e1", role: "user", text: "x", chatId: "the-chat" } as any);
    const frames = m.ingest(e);
    for (const f of frames) {
      expect(f["chat-id"]).toBe("the-chat");
    }
  });

  it("tool_result with ok=false marks the matching tool_use block as error", () => {
    const m = createMaterializer();
    m.ingest(
      ev({
        kind: "tool_use",
        id: "tu-1",
        toolName: "Read",
        toolUseId: "use-X",
        input: {},
      } as any),
    );
    m.ingest(
      ev({
        kind: "tool_result",
        id: "tr-1",
        toolUseId: "use-X",
        ok: false,
        output: "boom",
      } as any),
    );
    const it = m.snapshot().items.find(
      (i) => i.kind === "assistant-message",
    );
    expect(it).toBeDefined();
    if (it?.kind === "assistant-message") {
      const tb = it.blocks.find((b) => b.type === "tool_use");
      expect(tb).toBeDefined();
      if (tb && tb.type === "tool_use") {
        expect(tb.status).toBe("error");
        expect(tb.result?.isError).toBe(true);
      }
    }
  });

  it("tool_use produces an assistant item carrying a tool_use block", () => {
    const m = createMaterializer();
    const frames = m.ingest(
      ev({
        kind: "tool_use",
        id: "e-tu",
        toolName: "Read",
        toolUseId: "tu-1",
        input: { file_path: "x.txt" },
      } as any),
    );
    const ap = frames.find((f) => f.kind === "item-append");
    expect(ap).toBeDefined();
    if (ap?.kind === "item-append" && ap.body.item.kind === "assistant-message") {
      const block = ap.body.item.blocks[0];
      expect(block?.type).toBe("tool_use");
    }
  });
});

describe("jsonl/materializer — golden fixture parity", () => {
  const FIXTURE_DIR = join(__dirname, "fixtures", "jsonl");
  const fixtures = readdirSync(FIXTURE_DIR).filter((n) => n.endsWith(".jsonl")).sort();

  for (const fx of fixtures) {
    it(`fixture: ${fx} ingest produces deterministic ChatItem[] + replay matches`, () => {
      const lines = readFileSync(join(FIXTURE_DIR, fx), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      const fxCtx: TranslatorCtx = { chatId: `chat-${fx}`, sessionId: `session-${fx}` };
      const events = translateMany(lines, fxCtx);

      const a = createMaterializer({ chatId: fxCtx.chatId });
      const allFramesA: ServerFrame[] = [];
      for (const e of events) allFramesA.push(...a.ingest(e));

      const b = createMaterializer({ chatId: fxCtx.chatId });
      const allFramesB: ServerFrame[] = [];
      for (const e of events) allFramesB.push(...b.ingest(e));

      expect(b.snapshot()).toEqual(a.snapshot());
      expect(allFramesB).toEqual(allFramesA);

      // Re-feeding the SAME events emits zero new frames (dedupe on full replay).
      const reFrames: ServerFrame[] = [];
      for (const e of events) reFrames.push(...a.ingest(e));
      expect(reFrames).toEqual([]);
    });
  }
});
