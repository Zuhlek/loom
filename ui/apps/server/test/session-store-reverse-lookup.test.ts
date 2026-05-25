/**
 * SessionIdStore.findByClaudeSessionId — reverse lookup used by the
 * hook-receiver to map Claude's `session_id` (UUID) back to the loom
 * chatId that owns it. Real Claude Code hook events carry only
 * `session_id`, so without this lookup the receiver has no way to
 * resolve which chat a hook belongs to.
 */
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
  dir = mkdtempSync(join(tmpdir(), "session-store-reverse-"));
  storagePath = join(dir, "session-store.json");
  store = createSessionIdStore({ storagePath });
});

describe("SessionIdStore.findByClaudeSessionId", () => {
  it("returns the chatId for a known sessionId", async () => {
    const entry = await store.getOrCreate("chat-a", "/tmp/cwd");
    const found = await store.findByClaudeSessionId(entry.sessionId);
    expect(found).toBe("chat-a");
  });

  it("returns undefined for an unknown sessionId", async () => {
    await store.getOrCreate("chat-a", "/tmp/cwd");
    const found = await store.findByClaudeSessionId("never-minted-uuid");
    expect(found).toBeUndefined();
  });

  it("returns the correct chat among many", async () => {
    const a = await store.getOrCreate("chat-a", "/tmp/a");
    const b = await store.getOrCreate("chat-b", "/tmp/b");
    const c = await store.getOrCreate("chat-c", "/tmp/c");
    expect(await store.findByClaudeSessionId(a.sessionId)).toBe("chat-a");
    expect(await store.findByClaudeSessionId(b.sessionId)).toBe("chat-b");
    expect(await store.findByClaudeSessionId(c.sessionId)).toBe("chat-c");
  });

  it("survives upsert — new sessionId resolves, old one does not", async () => {
    const orig = await store.getOrCreate("chat-a", "/tmp/cwd");
    await store.upsert("chat-a", "rotated-uuid", "/tmp/cwd");
    expect(await store.findByClaudeSessionId("rotated-uuid")).toBe("chat-a");
    expect(await store.findByClaudeSessionId(orig.sessionId)).toBeUndefined();
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
