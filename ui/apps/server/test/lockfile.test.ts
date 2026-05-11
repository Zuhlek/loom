import { describe, test, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { acquireLock } from "../src/lockfile.ts";

function tmpLock(): string {
  return path.join(os.tmpdir(), `loom-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("acquireLock", () => {
  test("clean acquire writes the current PID and releases", () => {
    const p = tmpLock();
    const r = acquireLock(p);
    expect(r.ok).toBe(true);
    const content = fs.readFileSync(p, "utf8").trim();
    expect(parseInt(content, 10)).toBe(process.pid);
    r.release!();
    expect(fs.existsSync(p)).toBe(false);
  });

  test("second acquire fails with already-running when first PID is alive", () => {
    const p = tmpLock();
    // Simulate another live process: write our own pid (it IS alive).
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(process.pid));
    // With our PID in the file, acquireLock from this same process should
    // recognise PID == own PID and proceed (not block self). Use a different
    // tmp with a fake pid to test the busy path.
    const p2 = tmpLock();
    fs.mkdirSync(path.dirname(p2), { recursive: true });
    // Write the parent PID — almost certainly alive.
    fs.writeFileSync(p2, String(process.ppid || 1));
    const r2 = acquireLock(p2);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("already-running");
    expect(typeof r2.message).toBe("string");
    fs.unlinkSync(p2);
    fs.unlinkSync(p);
  });

  test("stale lock from dead PID is overwritten", () => {
    const p = tmpLock();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Pick a PID that's almost certainly dead.
    fs.writeFileSync(p, "999999");
    const r = acquireLock(p);
    expect(r.ok).toBe(true);
    expect(parseInt(fs.readFileSync(p, "utf8").trim(), 10)).toBe(process.pid);
    r.release!();
  });

  test("stale lock with garbage contents is overwritten", () => {
    const p = tmpLock();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "not-a-pid\n");
    const r = acquireLock(p);
    expect(r.ok).toBe(true);
    expect(parseInt(fs.readFileSync(p, "utf8").trim(), 10)).toBe(process.pid);
    r.release!();
    expect(fs.existsSync(p)).toBe(false);
  });

  test("release is idempotent", () => {
    const p = tmpLock();
    const r = acquireLock(p);
    expect(r.ok).toBe(true);
    r.release!();
    // Calling again should not throw and should leave file absent.
    r.release!();
    expect(fs.existsSync(p)).toBe(false);
  });

  test("release leaves file alone if a later acquirer rewrote it", () => {
    const p = tmpLock();
    const r = acquireLock(p);
    expect(r.ok).toBe(true);
    // Simulate a different process clobbering the lock.
    fs.writeFileSync(p, "12345");
    r.release!();
    // The newer file should still be there — release shouldn't have
    // deleted another PID's lock.
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf8").trim()).toBe("12345");
    fs.unlinkSync(p);
  });
});
