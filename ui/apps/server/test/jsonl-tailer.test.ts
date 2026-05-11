import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { JsonlTailer, encodeProjectDir, transcriptsDir } from "../src/jsonl-tailer";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "loom-tailer-"));
}

describe("jsonl-tailer", () => {
  test("emits each existing line on start", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, '{"a":1}\n{"b":2}\n');
    const tailer = new JsonlTailer(file);
    const seen: any[] = [];
    tailer.on("entry", (e) => seen.push(e));
    await tailer.start();
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
    tailer.stop();
    rmSync(dir, { recursive: true });
  });

  test("emits new lines appended after start", async () => {
    const dir = tmp();
    const file = path.join(dir, "session.jsonl");
    writeFileSync(file, "");
    const tailer = new JsonlTailer(file, { debounceMs: 20 });
    const seen: any[] = [];
    tailer.on("entry", (e) => seen.push(e));
    await tailer.start();
    appendFileSync(file, '{"c":3}\n');
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([{ c: 3 }]);
    tailer.stop();
    rmSync(dir, { recursive: true });
  });

  test("encodeProjectDir mirrors Claude Code's encoding convention", () => {
    // Real Claude Code keeps the leading hyphen — every '/' maps to '-'.
    expect(encodeProjectDir("/Users/tristan/dev/repo/loom")).toBe("-Users-tristan-dev-repo-loom");
  });

  test("transcriptsDir composes the path under ~/.claude/projects/", () => {
    const dir = transcriptsDir("/x/y", "/fake/.claude");
    expect(dir).toBe("/fake/.claude/projects/-x-y");
  });

  test("error event fires for malformed JSONL", async () => {
    const dir = tmp();
    const file = path.join(dir, "bad.jsonl");
    writeFileSync(file, "not-json\n");
    const tailer = new JsonlTailer(file);
    let err: Error | null = null;
    tailer.on("error", (e) => (err = e));
    await tailer.start();
    expect(err).not.toBeNull();
    tailer.stop();
    rmSync(dir, { recursive: true });
  });
});
