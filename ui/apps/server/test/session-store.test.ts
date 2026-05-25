import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSessionIdStore,
  type SessionIdStore,
} from "../src/process-manager/session-store.ts";

let dir: string;
let storagePath: string;
let store: SessionIdStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "session-store-"));
  storagePath = join(dir, "session-store.json");
  store = createSessionIdStore({ storagePath });
});

describe("SessionIdStore", () => {
  it("get returns undefined for an unknown chat", async () => {
    expect(await store.get("c-unknown")).toBeUndefined();
  });

  it("getOrCreate generates a fresh entry on first call and persists it", async () => {
    const a = await store.getOrCreate("c-1", "/tmp/cwd");
    expect(typeof a.sessionId).toBe("string");
    expect(a.sessionId.length).toBeGreaterThan(0);
    expect(a.cwd).toBe("/tmp/cwd");
    expect(typeof a.createdAt).toBe("string");
    expect(new Date(a.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("getOrCreate returns the SAME sessionId on subsequent calls for the same chat", async () => {
    const a = await store.getOrCreate("c-1", "/tmp/cwd");
    const b = await store.getOrCreate("c-1", "/tmp/cwd-DIFFERENT");
    expect(b.sessionId).toBe(a.sessionId);
    // cwd is captured at first create — second call returns the stored cwd.
    expect(b.cwd).toBe(a.cwd);
    expect(b.createdAt).toBe(a.createdAt);
  });

  it("delete removes the entry; subsequent getOrCreate produces a fresh sessionId", async () => {
    const a = await store.getOrCreate("c-1", "/tmp/cwd");
    await store.delete("c-1");
    expect(await store.get("c-1")).toBeUndefined();
    const b = await store.getOrCreate("c-1", "/tmp/cwd");
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  it("persistence survives a simulated restart", async () => {
    const a = await store.getOrCreate("c-1", "/tmp/cwd");
    const b = await store.getOrCreate("c-2", "/tmp/cwd2");
    // Simulate restart: new instance against the same storagePath.
    const fresh = createSessionIdStore({ storagePath });
    const a2 = await fresh.get("c-1");
    const b2 = await fresh.get("c-2");
    expect(a2?.sessionId).toBe(a.sessionId);
    expect(b2?.sessionId).toBe(b.sessionId);
    expect(a2?.cwd).toBe("/tmp/cwd");
    expect(b2?.cwd).toBe("/tmp/cwd2");
  });

  it("concurrent getOrCreate for the same new chatId produces exactly one sessionId", async () => {
    const [a, b, c] = await Promise.all([
      store.getOrCreate("c-concurrent", "/tmp/cwd"),
      store.getOrCreate("c-concurrent", "/tmp/cwd"),
      store.getOrCreate("c-concurrent", "/tmp/cwd"),
    ]);
    expect(b.sessionId).toBe(a.sessionId);
    expect(c.sessionId).toBe(a.sessionId);
  });

  it("UUIDs are unique across distinct chats", async () => {
    const a = await store.getOrCreate("c-1", "/tmp/cwd");
    const b = await store.getOrCreate("c-2", "/tmp/cwd");
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("storage file is valid JSON containing the persisted shape", async () => {
    await store.getOrCreate("c-1", "/tmp/cwd");
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed["c-1"]).toBeDefined();
    expect(typeof parsed["c-1"].sessionId).toBe("string");
    expect(typeof parsed["c-1"].cwd).toBe("string");
    expect(typeof parsed["c-1"].createdAt).toBe("string");
  });

  it("missing storage file is fine — store starts empty", async () => {
    expect(await store.get("c-nonexistent")).toBeUndefined();
  });

  // cleanup
  it("[cleanup]", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
