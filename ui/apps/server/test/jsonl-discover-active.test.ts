/**
 * T-026 — directory-scan-based active JSONL discovery.
 *
 * Red phase: this file pins behaviour the bridge depends on to fix M6
 * (the tail was reading the wrong file because the persisted sessionId
 * mapping drifted from what claude actually wrote on disk).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  utimesSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverActiveJsonl } from "../src/process-manager/jsonl/discover-active-jsonl.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-discover-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("discoverActiveJsonl", () => {
  it("returns null for an empty directory", async () => {
    const r = await discoverActiveJsonl(dir);
    expect(r).toBeNull();
  });

  it("returns null when the directory does not exist", async () => {
    const r = await discoverActiveJsonl(join(dir, "does-not-exist"));
    expect(r).toBeNull();
  });

  it("returns the only .jsonl file with the inner sessionId extracted", async () => {
    const filePath = join(dir, "abc-123.jsonl");
    writeFileSync(
      filePath,
      JSON.stringify({ type: "summary", sessionId: "abc-123" }) + "\n",
    );
    const r = await discoverActiveJsonl(dir);
    expect(r).not.toBeNull();
    expect(r!.filePath).toBe(filePath);
    expect(r!.sessionId).toBe("abc-123");
    expect(typeof r!.mtimeMs).toBe("number");
  });

  it("picks the most-recently-modified .jsonl when several exist", async () => {
    const older = join(dir, "older.jsonl");
    const newer = join(dir, "newer.jsonl");
    writeFileSync(
      older,
      JSON.stringify({ type: "summary", sessionId: "older-sess" }) + "\n",
    );
    writeFileSync(
      newer,
      JSON.stringify({ type: "summary", sessionId: "newer-sess" }) + "\n",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(older, past, past);
    const r = await discoverActiveJsonl(dir);
    expect(r!.filePath).toBe(newer);
    expect(r!.sessionId).toBe("newer-sess");
  });

  it("ignores files that are not .jsonl", async () => {
    writeFileSync(join(dir, "ignored.txt"), "ignored");
    writeFileSync(join(dir, "ignored.json"), "{}");
    writeFileSync(join(dir, "ignored.jsonl.bak"), "{}");
    const target = join(dir, "actual.jsonl");
    writeFileSync(
      target,
      JSON.stringify({ type: "summary", sessionId: "actual-sess" }) + "\n",
    );
    const r = await discoverActiveJsonl(dir);
    expect(r!.filePath).toBe(target);
  });

  it("ignores non-.jsonl files even when they are NEWER than the .jsonl file", async () => {
    // Mutation guard: if the extension gate is removed, a newer non-jsonl
    // file would mask the .jsonl candidate.
    const jsonlPath = join(dir, "real.jsonl");
    writeFileSync(
      jsonlPath,
      JSON.stringify({ type: "summary", sessionId: "real-sess" }) + "\n",
    );
    // Make the jsonl file older than now.
    const past = new Date(Date.now() - 60_000);
    utimesSync(jsonlPath, past, past);
    // Newer sibling that must be ignored.
    const distractor = join(dir, "newer.txt");
    writeFileSync(distractor, "newer");
    const r = await discoverActiveJsonl(dir);
    expect(r).not.toBeNull();
    expect(r!.filePath).toBe(jsonlPath);
    expect(r!.sessionId).toBe("real-sess");
  });

  it("returns sessionId=null when the first line is unparseable", async () => {
    const filePath = join(dir, "garbled.jsonl");
    writeFileSync(filePath, "not-json garbage\n");
    const r = await discoverActiveJsonl(dir);
    expect(r).not.toBeNull();
    expect(r!.filePath).toBe(filePath);
    expect(r!.sessionId).toBeNull();
  });

  it("returns sessionId=null when the file is empty", async () => {
    const filePath = join(dir, "empty.jsonl");
    writeFileSync(filePath, "");
    const r = await discoverActiveJsonl(dir);
    expect(r).not.toBeNull();
    expect(r!.filePath).toBe(filePath);
    expect(r!.sessionId).toBeNull();
  });

  it("ignores subdirectories named *.jsonl even when they are NEWER than the .jsonl file", async () => {
    // Mutation guard: without the isFile() gate a `weird.jsonl/` dir
    // would mask the real candidate. Make the dir newer than the file
    // so simply sorting by mtime is not enough — the gate must filter.
    const target = join(dir, "real.jsonl");
    writeFileSync(
      target,
      JSON.stringify({ type: "summary", sessionId: "real-sess" }) + "\n",
    );
    const past = new Date(Date.now() - 60_000);
    utimesSync(target, past, past);
    // mkdir AFTER backdating the file so the dir's mtime is newer.
    mkdirSync(join(dir, "weird.jsonl"));
    const r = await discoverActiveJsonl(dir);
    expect(r!.filePath).toBe(target);
  });
});
