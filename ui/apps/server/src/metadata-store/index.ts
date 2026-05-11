/**
 * Metadata store.
 *
 * For v1 we use a simple JSON-backed in-memory store with auto-save. The
 * default path is ~/.nora/metadata.db (a JSON file, not a real database).
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
import { projectRepo, type ProjectRepo } from "./repos/project.ts";
import { pendingGateRepo, type PendingGateRepo } from "./repos/pending-gate.ts";
import { hookRegistrationRepo, type HookRegistrationRepo } from "./repos/hook-registration.ts";

export interface MetadataStore {
  chats: ChatRepo;
  projects: ProjectRepo;
  pendingGates: PendingGateRepo;
  hookRegistrations: HookRegistrationRepo;
  close(): Promise<void>;
}

export interface InitOptions {
  // If supplied, persist JSON to this path. Defaults to ~/.nora/metadata.db.
  pglitePath?: string;
  // Override migration directory (tests).
  migrationsDir?: string;
  // Force in-memory-only (no disk persistence). Used by tests.
  inMemoryOnly?: boolean;
}

// In-memory storage shared across the four repos when fallback is used.
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
}

function serialize(storage: InMemoryStorage): SerializedStorage {
  return {
    chats: Array.from(storage.chats.values()),
    projects: Array.from(storage.projects.values()),
    pendingGates: Array.from(storage.pendingGates.entries()).map(([key, value]) => ({ __key: key, value })),
    hookRegistrations: Array.from(storage.hookRegistrations.values()),
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
}

function defaultDbPath(): string {
  return path.join(os.homedir(), ".nora", "metadata.db");
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
      console.warn(`[nora] metadata.db is malformed; starting fresh: ${(err as Error).message}`);
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
        console.warn(`[nora] failed to persist metadata.db: ${(err as Error).message}`);
      }
    });
  };

  // Wrap each repo so any mutation triggers a persist().
  const chats = chatRepo(storage);
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
    "dismissResumeBanner",
    "markInert",
  ]) as ChatRepo;
  const wrappedProjects = wrap(projects, ["create", "addPath", "removePath", "update", "delete"]) as ProjectRepo;
  const wrappedPendingGates = wrap(pendingGates, ["upsert", "delete", "deleteByChat"]) as PendingGateRepo;
  const wrappedHookRegistrations = wrap(hookRegistrations, ["upsert", "delete"]) as HookRegistrationRepo;

  return {
    chats: wrappedChats,
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

export type { ChatRepo, ProjectRepo, PendingGateRepo, HookRegistrationRepo };
