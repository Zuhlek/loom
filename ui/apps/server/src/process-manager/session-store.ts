/**
 * SessionIdStore — persists `chatId → { sessionId, cwd, createdAt }`.
 *
 * Session-ID provenance: one UUID per chat, persisted to disk so server restarts reuse the same
 * `--session-id` (avoiding `claude`'s "session ID already in use" failure
 * mode). A `chat-id` only gets a fresh UUID at first-create or after an
 * explicit `delete(...)` (driven by `retrySession` / `dispose`).
 *
 * Storage shape per Design §Data model:
 *   { [chatId]: { sessionId: string; cwd: string; createdAt: string } }
 * JSON on disk. Read once on first call, written through after every
 * mutation. Concurrent `getOrCreate` for the same new `chatId` is
 * serialised through an in-memory promise per chatId so only one UUID is
 * generated.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SessionEntry {
  sessionId: string;
  cwd: string;
  createdAt: string;
}

export interface SessionIdStore {
  getOrCreate(chatId: string, cwd: string): Promise<SessionEntry>;
  delete(chatId: string): Promise<void>;
  /**
   * Replace the persisted entry for `chatId` with an explicit
   * sessionId. The bridge calls this when directory-scan discovery
   * reveals claude rotated to a different sessionId on disk — the
   * on-disk truth wins so subsequent restarts converge. Idempotent.
   * `cwd` falls back to the existing entry's cwd when omitted.
   */
  upsert(chatId: string, sessionId: string, cwd?: string): Promise<SessionEntry>;
  /**
   * Reverse lookup: given Claude's session_id (UUID), find the loom chatId
   * that owns it. Used by the hook-receiver to map inbound hook events
   * (which carry `session_id` only) back to a loom chat. Returns
   * `undefined` if no chat owns the sessionId.
   */
  findByClaudeSessionId(sessionId: string): Promise<string | undefined>;
}

export interface SessionIdStoreOptions {
  storagePath: string;
}

type Storage = Record<string, SessionEntry>;

export function createSessionIdStore(opts: SessionIdStoreOptions): SessionIdStore {
  const { storagePath } = opts;

  // In-memory cache. Loaded lazily on the first call.
  let cache: Storage | undefined;
  let loadPromise: Promise<Storage> | undefined;
  // Per-chatId create promise — serialises concurrent `getOrCreate`
  // for the same new chat-id so only one UUID is generated.
  const inFlight = new Map<string, Promise<SessionEntry>>();
  // Single-writer queue: chains writes so two simultaneous mutators
  // do not interleave the file content.
  let writeQueue: Promise<void> = Promise.resolve();

  async function loadFromDisk(): Promise<Storage> {
    try {
      const raw = await readFile(storagePath, "utf8");
      const parsed = JSON.parse(raw) as Storage;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return {};
      // For any other read error, treat as empty rather than crashing
      // the server — the store will write a fresh file on next mutation.
      return {};
    }
  }

  async function ensureLoaded(): Promise<Storage> {
    if (cache) return cache;
    if (!loadPromise) loadPromise = loadFromDisk();
    cache = await loadPromise;
    return cache;
  }

  function flush(snapshot: Storage): Promise<void> {
    // Chain writes so they are serial. Atomic via tmp + rename so a crash
    // mid-write does not corrupt the file.
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      const tmp = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(tmp, storagePath);
    });
    return writeQueue;
  }

  return {
    async getOrCreate(chatId, cwd) {
      const state = await ensureLoaded();
      const existing = state[chatId];
      if (existing) return existing;

      const pending = inFlight.get(chatId);
      if (pending) return pending;

      const create = (async () => {
        // Double-check inside the in-flight critical section in case the
        // entry materialised while we were awaiting `ensureLoaded`.
        const again = state[chatId];
        if (again) return again;

        const entry: SessionEntry = {
          sessionId: randomUUID(),
          cwd,
          createdAt: new Date().toISOString(),
        };
        state[chatId] = entry;
        try {
          await flush(state);
        } catch {
          // Best-effort persistence — keep the in-memory entry so the
          // current process still has a stable sessionId for this chat.
        }
        return entry;
      })();

      inFlight.set(chatId, create);
      try {
        return await create;
      } finally {
        inFlight.delete(chatId);
      }
    },

    async delete(chatId) {
      const state = await ensureLoaded();
      if (!(chatId in state)) return;
      delete state[chatId];
      await flush(state);
    },

    async upsert(chatId, sessionId, cwd) {
      const state = await ensureLoaded();
      const prior = state[chatId];
      const entry: SessionEntry = {
        sessionId,
        cwd: cwd ?? prior?.cwd ?? "",
        createdAt: prior?.createdAt ?? new Date().toISOString(),
      };
      state[chatId] = entry;
      try {
        await flush(state);
      } catch {
        // Best-effort persistence — keep the in-memory entry.
      }
      return entry;
    },

    async findByClaudeSessionId(sessionId) {
      const state = await ensureLoaded();
      for (const [chatId, entry] of Object.entries(state)) {
        if (entry.sessionId === sessionId) return chatId;
      }
      return undefined;
    },
  };
}
