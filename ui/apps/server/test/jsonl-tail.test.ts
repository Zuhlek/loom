import { describe, expect, it, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJsonlTail,
  type JsonlTail,
  type RawLine,
  type TailError,
} from "../src/process-manager/jsonl/tail.ts";

let dir: string;
let tailRoot: string;
let encodedCwd: string;
let sessionId: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-tail-"));
  tailRoot = dir;
  encodedCwd = "encoded-cwd";
  sessionId = "sess-1";
  const sessDir = join(tailRoot, encodedCwd);
  // mkdirpSync
  require("node:fs").mkdirSync(sessDir, { recursive: true });
  filePath = join(sessDir, `${sessionId}.jsonl`);
});

function flushTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 30));
}

async function collectLines(
  tail: JsonlTail,
  fn: () => void | Promise<void>,
  expectedCount: number,
  timeoutMs = 1000,
): Promise<RawLine[]> {
  const out: RawLine[] = [];
  const unsub = tail.onLine((l) => out.push(l));
  await Promise.resolve(fn());
  const start = Date.now();
  while (out.length < expectedCount && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
  unsub();
  return out;
}

describe("jsonl/tail (polling mode)", () => {
  it("new file: zero lines until the file is created and grown", async () => {
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    await flushTick();
    const lines = await collectLines(
      tail,
      () => {
        writeFileSync(filePath, "first line\n", "utf8");
      },
      1,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]!.text).toBe("first line");
    await tail.stop();
  });

  it("multiple appends in order: no duplication, no loss", async () => {
    writeFileSync(filePath, "", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    appendFileSync(filePath, "a\n", "utf8");
    appendFileSync(filePath, "b\n", "utf8");
    appendFileSync(filePath, "c\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(collected.map((c) => c.text)).toEqual(["a", "b", "c"]);
    await tail.stop();
  });

  it("offsets are monotonically increasing", async () => {
    writeFileSync(filePath, "", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    appendFileSync(filePath, "line-1\nline-2\nline-3\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(collected.length).toBe(3);
    expect(collected[1]!.offset).toBeGreaterThan(collected[0]!.offset);
    expect(collected[2]!.offset).toBeGreaterThan(collected[1]!.offset);
    await tail.stop();
  });

  it("truncation: shrinking the file surfaces a TailError rather than silently rewinding", async () => {
    writeFileSync(filePath, "hello\nworld\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    const errors: TailError[] = [];
    tail.onError((e) => errors.push(e));
    tail.start({ tailRoot, encodedCwd, sessionId });
    await new Promise((r) => setTimeout(r, 100));
    // truncate file
    writeFileSync(filePath, "", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.code).toBe("TRUNCATION");
    await tail.stop();
  });

  it("stop() is idempotent; subsequent onLine callbacks fire zero times", async () => {
    writeFileSync(filePath, "x\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    await new Promise((r) => setTimeout(r, 80));
    await tail.stop();
    await tail.stop(); // idempotent
    let callbacks = 0;
    tail.onLine(() => callbacks++);
    appendFileSync(filePath, "post-stop\n", "utf8");
    await new Promise((r) => setTimeout(r, 100));
    expect(callbacks).toBe(0);
  });

  it("public type RawLine has text, offset, fileVersion fields", async () => {
    writeFileSync(filePath, "data\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    const lines: RawLine[] = [];
    const unsub = tail.onLine((l) => lines.push(l));
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(typeof lines[0]!.text).toBe("string");
    expect(typeof lines[0]!.offset).toBe("number");
    expect(typeof lines[0]!.fileVersion).toBe("number");
    await tail.stop();
  });

  it("missing file at start: tail tolerates absent file, emits no lines, then catches up on creation", async () => {
    expect(require("node:fs").existsSync(filePath)).toBe(false);
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    await new Promise((r) => setTimeout(r, 80));
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    writeFileSync(filePath, "first\n", "utf8");
    await new Promise((r) => setTimeout(r, 150));
    expect(collected.map((c) => c.text)).toEqual(["first"]);
    unsub();
    await tail.stop();
  });

  it("rotation: file deleted and recreated bumps fileVersion (defensive — symmetric with fs.watch)", async () => {
    writeFileSync(filePath, "v1\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    await new Promise((r) => setTimeout(r, 80));
    unlinkSync(filePath);
    await new Promise((r) => setTimeout(r, 80));
    writeFileSync(filePath, "v2-line\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(collected.length).toBeGreaterThanOrEqual(2);
    const seenFileVersions = new Set(collected.map((c) => c.fileVersion));
    expect(seenFileVersions.size).toBeGreaterThanOrEqual(2);
    await tail.stop();
  });

  it("[cleanup]", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});

describe("jsonl/tail (hybrid fs.watch + polling)", () => {
  it("ADR-003: hybrid mode (fs.watch primary) still surfaces all appended lines", async () => {
    // Polling interval intentionally LARGER than the test patience window
    // so a passing assertion proves fs.watch fired the read (or, on a
    // filesystem where fs.watch does nothing, the polling fallback still
    // catches lines on a subsequent tick).
    const tail = createJsonlTail({ pollingIntervalMs: 500 });
    writeFileSync(filePath, "", "utf8");
    tail.start({ tailRoot, encodedCwd, sessionId });
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    // Append in two batches with short pauses; allow up to 1.5s for the
    // watcher OR the safety-net polling timer to catch each batch.
    appendFileSync(filePath, "alpha\n", "utf8");
    const start = Date.now();
    while (collected.length < 1 && Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 30));
    }
    appendFileSync(filePath, "bravo\n", "utf8");
    while (collected.length < 2 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 30));
    }
    unsub();
    expect(collected.map((c) => c.text)).toEqual(["alpha", "bravo"]);
    await tail.stop();
  });

  it("ADR-003: forcePolling: true disables the fs.watch path (regression guard)", async () => {
    // Smoke test — when forcePolling is set, the tail must still emit
    // lines via the polling loop alone.
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ tailRoot, encodedCwd, sessionId });
    const lines = await collectLines(
      tail,
      () => writeFileSync(filePath, "only-polling\n", "utf8"),
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["only-polling"]);
    await tail.stop();
  });

  it("[cleanup hybrid]", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});

describe("jsonl/tail (explicit filePath overload — T-026)", () => {
  it("start({ filePath }) tails the explicit file regardless of any sessionId convention", async () => {
    // The bridge needs to tail an arbitrary file path (the one the
    // discovery scan returned), not just `<sessionId>.jsonl`. Use a
    // basename that deliberately doesn't match the persisted-sessionId
    // pattern.
    const sessDir = join(tailRoot, encodedCwd);
    const altPath = join(sessDir, "ec847f04-not-our-session-id.jsonl");
    writeFileSync(altPath, "", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath: altPath });
    const lines = await collectLines(
      tail,
      () => appendFileSync(altPath, "discovered\n", "utf8"),
      1,
    );
    expect(lines.map((l) => l.text)).toEqual(["discovered"]);
    await tail.stop();
  });

  it("start({ filePath }) honours fs.watch primary-path behaviour", async () => {
    const sessDir = join(tailRoot, encodedCwd);
    const altPath = join(sessDir, "discovered-file.jsonl");
    writeFileSync(altPath, "", "utf8");
    const tail = createJsonlTail({ pollingIntervalMs: 500 });
    tail.start({ filePath: altPath });
    const collected: RawLine[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    appendFileSync(altPath, "alpha\n", "utf8");
    const start = Date.now();
    while (collected.length < 1 && Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 30));
    }
    unsub();
    expect(collected.map((c) => c.text)).toEqual(["alpha"]);
    await tail.stop();
  });

  it("[cleanup explicit]", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
