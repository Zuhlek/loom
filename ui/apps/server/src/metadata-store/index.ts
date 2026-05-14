/**
 * Metadata store.
 *
 * For v1 we use a simple JSON-backed in-memory store with auto-save. The
 * default path is ~/.loom/metadata.db (a JSON file, not a real database).
 * Tests override the path or pass `inMemoryOnly: true` to keep behavior
 * deterministic.
 *
 * The original plan was to embed @electric-sql/pglite; deferred to a
 * follow-up because the JSON store is sufficient for the chats + projects
 * + pending-gates + hook-registrations surface and avoids a heavy
 * dependency.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { chatRepo, type ChatRepo } from "./repos/chat.ts";
import { chatItemsRepo, type ChatItemsRepo, type ChatItemRow } from "./repos/chat-items.ts";
import { projectRepo, type ProjectRepo } from "./repos/project.ts";
import { pendingGateRepo, type PendingGateRepo } from "./repos/pending-gate.ts";
import { hookRegistrationRepo, type HookRegistrationRepo } from "./repos/hook-registration.ts";

export interface MetadataStore {
  chats: ChatRepo;
  /**
   * Durable, ordered ChatItem log per chat. The bridge mirrors every
   * append/update here and replays from it on `spawn()` so the timeline
   * survives drain/respawn/server-restart. See
   * `./repos/chat-items.ts` for the t3code-inspired rationale.
   */
  chatItems: ChatItemsRepo;
  projects: ProjectRepo;
  pendingGates: PendingGateRepo;
  hookRegistrations: HookRegistrationRepo;
  close(): Promise<void>;
}

export interface InitOptions {
  // If supplied, persist JSON to this path. Defaults to ~/.loom/metadata.db.
  pglitePath?: string;
  // Override migration directory (tests).
  migrationsDir?: string;
  // Force in-memory-only (no disk persistence). Used by tests.
  inMemoryOnly?: boolean;
}

// In-memory storage shared across the repos when fallback is used.
// `chatItems` is attached lazily by `chatItemsRepo` on first use so
// existing direct callers of `newStorage()` keep working.
export interface InMemoryStorage {
  chats: Map<string, any>;
  projects: Map<string, any>;
  pendingGates: Map<string, any>; // key = chat_id|kind
  hookRegistrations: Map<string, any>;
}

function newStorage(): InMemoryStorage {
  return {
    chats: new Map(),
    projects: new Map(),
    pendingGates: new Map(),
    hookRegistrations: new Map(),
  };
}

interface SerializedStorage {
  chats: any[];
  projects: any[];
  pendingGates: any[];
  hookRegistrations: any[];
  /**
   * Flat list of ChatItem rows. Replayed in order on hydrate; the
   * per-chat ordering is reconstructed from each row's `seq`. Older
   * snapshots that pre-date this field load fine — `?? []` keeps them
   * a no-op.
   */
  chatItems?: ChatItemRow[];
}

function serialize(storage: InMemoryStorage): SerializedStorage {
  const itemsState = (storage as InMemoryStorage & {
    chatItems?: { byChat: Map<string, ChatItemRow[]> };
  }).chatItems;
  const chatItems: ChatItemRow[] = [];
  if (itemsState?.byChat) {
    for (const rows of itemsState.byChat.values()) {
      for (const row of rows) chatItems.push(row);
    }
  }
  return {
    chats: Array.from(storage.chats.values()),
    projects: Array.from(storage.projects.values()),
    pendingGates: Array.from(storage.pendingGates.entries()).map(([key, value]) => ({ __key: key, value })),
    hookRegistrations: Array.from(storage.hookRegistrations.values()),
    chatItems,
  };
}

function hydrate(storage: InMemoryStorage, data: SerializedStorage): void {
  for (const c of data.chats ?? []) storage.chats.set(c.id, c);
  for (const p of data.projects ?? []) storage.projects.set(p.id, p);
  for (const entry of data.pendingGates ?? []) {
    if (entry && entry.__key) storage.pendingGates.set(entry.__key, entry.value);
  }
  for (const h of data.hookRegistrations ?? []) {
    if (h && h.id) storage.hookRegistrations.set(h.id, h);
  }
  // Restore the chat-items log. Group rows by chat and sort by seq so
  // the in-memory order matches what was persisted, regardless of how
  // the JSON serialiser laid them out.
  const itemRows = data.chatItems ?? [];
  if (itemRows.length === 0) return;
  const itemsState = (storage as InMemoryStorage & {
    chatItems?: { byChat: Map<string, ChatItemRow[]>; nextSeq: Map<string, number> };
  });
  itemsState.chatItems = {
    byChat: new Map(),
    nextSeq: new Map(),
  };
  const grouped = new Map<string, ChatItemRow[]>();
  for (const row of itemRows) {
    if (!row || typeof row.chat_id !== "string" || typeof row.id !== "string") continue;
    let list = grouped.get(row.chat_id);
    if (!list) {
      list = [];
      grouped.set(row.chat_id, list);
    }
    list.push(row);
  }
  for (const [chatId, rows] of grouped) {
    rows.sort((a, b) => a.seq - b.seq);
    itemsState.chatItems!.byChat.set(chatId, rows);
    const lastSeq = rows[rows.length - 1]?.seq ?? 0;
    itemsState.chatItems!.nextSeq.set(chatId, lastSeq);
  }
}

function defaultDbPath(): string {
  return path.join(os.homedir(), ".loom", "metadata.db");
}

export async function initMetadataStore(opts: InitOptions = {}): Promise<MetadataStore> {
  const storage = newStorage();
  const migrationsDir =
    opts.migrationsDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  try {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      // Reading proves the migration exists & is parseable; idempotent.
      fs.readFileSync(path.join(migrationsDir, f), "utf8");
    }
  } catch {
    // ignore — environments without migrations dir still work
  }

  const dbPath = opts.inMemoryOnly ? null : opts.pglitePath ?? defaultDbPath();

  // Hydrate from disk if available.
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, "utf8");
      const parsed = JSON.parse(raw) as SerializedStorage;
      hydrate(storage, parsed);
    } catch (err) {
      console.warn(`[loom] metadata.db is malformed; starting fresh: ${(err as Error).message}`);
    }
  }

  let saveScheduled = false;
  let lastError: Error | null = null;
  const persist = () => {
    if (!dbPath) return;
    if (saveScheduled) return;
    saveScheduled = true;
    queueMicrotask(() => {
      saveScheduled = false;
      try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        fs.writeFileSync(dbPath, JSON.stringify(serialize(storage), null, 2), "utf8");
      } catch (err) {
        lastError = err as Error;
        console.warn(`[loom] failed to persist metadata.db: ${(err as Error).message}`);
      }
    });
  };

  // Wrap each repo so any mutation triggers a persist().
  const chats = chatRepo(storage);
  const chatItems = chatItemsRepo(storage);
  const projects = projectRepo(storage);
  const pendingGates = pendingGateRepo(storage);
  const hookRegistrations = hookRegistrationRepo(storage);

  const wrap = <T extends Record<string, any>>(repo: T, mutators: string[]): T => {
    const out: any = {};
    for (const key of Object.keys(repo)) {
      const fn = (repo as any)[key];
      if (typeof fn === "function" && mutators.includes(key)) {
        out[key] = (...args: any[]) => {
          const result = fn(...args);
          persist();
          return result;
        };
      } else {
        out[key] = fn;
      }
    }
    return out;
  };

  const wrappedChats = wrap(chats, [
    "create",
    "update",
    "delete",
    "setPid",
    "setSessionId",
    "setWorktreePath",
    "dismissResumeBanner",
    "markInert",
    "markActive",
    "setCustomName",
  ]) as ChatRepo;
  const wrappedChatItems = wrap(chatItems, ["append", "update", "clear"]) as ChatItemsRepo;
  const wrappedProjects = wrap(projects, ["create", "addPath", "removePath", "update", "delete"]) as ProjectRepo;
  const wrappedPendingGates = wrap(pendingGates, ["upsert", "delete", "deleteByChat"]) as PendingGateRepo;
  const wrappedHookRegistrations = wrap(hookRegistrations, ["upsert", "delete"]) as HookRegistrationRepo;

  return {
    chats: wrappedChats,
    chatItems: wrappedChatItems,
    projects: wrappedProjects,
    pendingGates: wrappedPendingGates,
    hookRegistrations: wrappedHookRegistrations,
    async close() {
      // Final flush.
      if (dbPath) {
        try {
          fs.mkdirSync(path.dirname(dbPath), { recursive: true });
          fs.writeFileSync(dbPath, JSON.stringify(serialize(storage), null, 2), "utf8");
        } catch {}
      }
      storage.chats.clear();
      storage.projects.clear();
      storage.pendingGates.clear();
      storage.hookRegistrations.clear();
    },
  };
}

export type { ChatRepo, ChatItemsRepo, ProjectRepo, PendingGateRepo, HookRegistrationRepo };
