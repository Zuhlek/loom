import { describe, expect, it, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJsonlTail, type JsonlTail } from "../src/process-manager/jsonl/tail.ts";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-tail-"));
  const sessDir = join(dir, "encoded-cwd");
  mkdirSync(sessDir, { recursive: true });
  filePath = join(sessDir, "sess-1.jsonl");
});

function flushTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 30));
}

async function collectLines(
  tail: JsonlTail,
  fn: () => void | Promise<void>,
  expectedCount: number,
  timeoutMs = 1000,
): Promise<string[]> {
  const out: string[] = [];
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
    tail.start({ filePath });
    await flushTick();
    const lines = await collectLines(
      tail,
      () => {
        writeFileSync(filePath, "first line\n", "utf8");
      },
      1,
    );
    expect(lines).toEqual(["first line"]);
    await tail.stop();
  });

  it("multiple appends in order: no duplication, no loss", async () => {
    writeFileSync(filePath, "", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    const collected: string[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    appendFileSync(filePath, "a\n", "utf8");
    appendFileSync(filePath, "b\n", "utf8");
    appendFileSync(filePath, "c\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(collected).toEqual(["a", "b", "c"]);
    await tail.stop();
  });

  it("truncation: shrinking the file restarts from 0 rather than silently rewinding", async () => {
    writeFileSync(filePath, "hello\nworld\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    await new Promise((r) => setTimeout(r, 100));
    // Truncate, then append fresh content: the tail must catch the new
    // line from offset 0 instead of waiting for the file to re-pass the
    // pre-truncation byte count.
    writeFileSync(filePath, "", "utf8");
    await new Promise((r) => setTimeout(r, 60));
    const collected = await collectLines(
      tail,
      () => appendFileSync(filePath, "after-truncate\n", "utf8"),
      1,
    );
    expect(collected).toContain("after-truncate");
    await tail.stop();
  });

  it("stop() is idempotent; subsequent onLine callbacks fire zero times", async () => {
    writeFileSync(filePath, "x\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    await new Promise((r) => setTimeout(r, 80));
    await tail.stop();
    await tail.stop(); // idempotent
    let callbacks = 0;
    tail.onLine(() => callbacks++);
    appendFileSync(filePath, "post-stop\n", "utf8");
    await new Promise((r) => setTimeout(r, 100));
    expect(callbacks).toBe(0);
  });

  it("emits complete lines as plain strings", async () => {
    writeFileSync(filePath, "data\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    const lines: string[] = [];
    const unsub = tail.onLine((l) => lines.push(l));
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(typeof lines[0]).toBe("string");
    expect(lines[0]).toBe("data");
    await tail.stop();
  });

  it("missing file at start: tail tolerates absent file, emits no lines, then catches up on creation", async () => {
    expect(existsSync(filePath)).toBe(false);
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    await new Promise((r) => setTimeout(r, 80));
    const collected: string[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    writeFileSync(filePath, "first\n", "utf8");
    await new Promise((r) => setTimeout(r, 150));
    expect(collected).toEqual(["first"]);
    unsub();
    await tail.stop();
  });

  it("rotation: file deleted and recreated still surfaces the new content", async () => {
    writeFileSync(filePath, "v1\n", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    const collected: string[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    await new Promise((r) => setTimeout(r, 80));
    unlinkSync(filePath);
    await new Promise((r) => setTimeout(r, 80));
    writeFileSync(filePath, "v2-line\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));
    unsub();
    expect(collected).toContain("v1");
    expect(collected).toContain("v2-line");
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
    tail.start({ filePath });
    const collected: string[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
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
    expect(collected).toEqual(["alpha", "bravo"]);
    await tail.stop();
  });

  it("ADR-003: forcePolling: true disables the fs.watch path (regression guard)", async () => {
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath });
    const lines = await collectLines(
      tail,
      () => writeFileSync(filePath, "only-polling\n", "utf8"),
      1,
    );
    expect(lines).toEqual(["only-polling"]);
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
    const altPath = join(dir, "encoded-cwd", "ec847f04-not-our-session-id.jsonl");
    writeFileSync(altPath, "", "utf8");
    const tail = createJsonlTail({ forcePolling: true, pollingIntervalMs: 30 });
    tail.start({ filePath: altPath });
    const lines = await collectLines(
      tail,
      () => appendFileSync(altPath, "discovered\n", "utf8"),
      1,
    );
    expect(lines).toEqual(["discovered"]);
    await tail.stop();
  });

  it("start({ filePath }) honours fs.watch primary-path behaviour", async () => {
    const altPath = join(dir, "encoded-cwd", "discovered-file.jsonl");
    writeFileSync(altPath, "", "utf8");
    const tail = createJsonlTail({ pollingIntervalMs: 500 });
    tail.start({ filePath: altPath });
    const collected: string[] = [];
    const unsub = tail.onLine((l) => collected.push(l));
    appendFileSync(altPath, "alpha\n", "utf8");
    const start = Date.now();
    while (collected.length < 1 && Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 30));
    }
    unsub();
    expect(collected).toEqual(["alpha"]);
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
