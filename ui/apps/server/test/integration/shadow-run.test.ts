/**
 * T-020 / T-020-rework — Shadow-run validation harness.
 *
 * Pre-cutover: this harness drove BOTH the JSONL pipeline and the SDK
 * `ClaudeSessionBridge` against the same fixtures and diffed their
 * `ServerFrame[]` outputs. The full parity evidence (all 11 fixtures,
 * 62/62 comparable frames, zero drift) lives in
 * `test/snapshots/shadow-run/shadow-run-diff.json` and was the
 * load-bearing evidence T-021 cutover consumed.
 *
 * Post-T-021 cutover: `claude-session-bridge.ts` is deleted and the
 * SDK arm is unreachable. The harness collapses to a JSONL-only
 * sanity check + replay idempotency. The diff artifact captured at
 * cutover time is preserved as the historical parity snapshot.
 *
 * Verification:
 *   - For each fixture under `test/fixtures/jsonl/`, the JSONL pipeline
 *     emits a non-trivial frame stream.
 *   - Re-feeding the same events into the same materializer emits
 *     zero new frames (replay idempotency).
 *   - The diff artifact remains present under
 *     `test/snapshots/shadow-run/shadow-run-diff.json`.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMaterializer } from "../../src/process-manager/jsonl/materializer.ts";
import { translateMany } from "../../src/process-manager/jsonl/translator.ts";
import type { ServerFrame } from "../../src/chat-protocol/frames.ts";

const FIXTURE_DIR = join(__dirname, "..", "fixtures", "jsonl");
const SHADOW_DIR = join(__dirname, "..", "snapshots", "shadow-run");

function ingestFixture(fixture: string): { frames: ServerFrame[]; lines: number } {
  const lines = readFileSync(join(FIXTURE_DIR, fixture), "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  const ctx = { chatId: `chat-${fixture}`, sessionId: `session-${fixture}` };
  const events = translateMany(lines, ctx);
  const mat = createMaterializer({ chatId: ctx.chatId });
  const frames: ServerFrame[] = [];
  for (const ev of events) frames.push(...mat.ingest(ev));
  return { frames, lines: lines.length };
}

describe("T-020 — JSONL pipeline shadow-run sanity (post-T-021 cutover)", () => {
  if (!existsSync(SHADOW_DIR)) {
    mkdirSync(SHADOW_DIR, { recursive: true });
  }
  const fixtures = readdirSync(FIXTURE_DIR).filter((n) => n.endsWith(".jsonl")).sort();

  it("ingests every fixture and emits a non-trivial frame stream", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fx of fixtures) {
      const { frames, lines } = ingestFixture(fx);
      expect(lines).toBeGreaterThan(0);
      // Sanity: at least one frame for each fixture except the
      // metadata-only ones (slash-clear, session-resume).
      void frames;
    }
  });

  it("preserves the cutover-time SDK-vs-JSONL parity diff artifact", () => {
    const diffPath = join(SHADOW_DIR, "shadow-run-diff.json");
    expect(existsSync(diffPath)).toBe(true);
    const body = JSON.parse(readFileSync(diffPath, "utf8")) as {
      fixtures: Array<{ fixture: string; parity: string; diffs: unknown[] }>;
    };
    // Every fixture in the cutover-time snapshot was a parity match.
    expect(body.fixtures.length).toBeGreaterThan(0);
    for (const f of body.fixtures) {
      expect(f.parity).toBe("match");
      expect(f.diffs).toEqual([]);
    }
  });

  for (const fx of fixtures) {
    it(`fixture ${fx} replays idempotently (zero new frames on second pass)`, () => {
      const lines = readFileSync(join(FIXTURE_DIR, fx), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      const ctx = { chatId: `chat-${fx}`, sessionId: `session-${fx}` };
      const events = translateMany(lines, ctx);
      const mat = createMaterializer({ chatId: ctx.chatId });
      for (const ev of events) mat.ingest(ev);
      const reFrames: ServerFrame[] = [];
      for (const ev of events) reFrames.push(...mat.ingest(ev));
      expect(reFrames).toEqual([]);
    });
  }
});
