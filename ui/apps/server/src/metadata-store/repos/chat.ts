/**
 * Chat repository.
 */
import * as crypto from "node:crypto";
import type { InMemoryStorage } from "../index.ts";
import type { WireModelSettings } from "../../chat-protocol/messages.ts";

function generateSessionId(): string {
  // randomUUID returns a v4 UUID — exactly what Claude Code expects
  // for `--session-id`.
  return crypto.randomUUID();
}

export interface ChatRow {
  id: string;
  project_id: string | null;
  cwd: string;
  permission_mode: "default" | "plan" | "accept-edits" | "trusted-vm";
  worktree_mode: "local" | "worktree";
  worktree_path: string | null;
  session_id: string | null;
  pid: number | null;
  last_opened: string;
  pinned: boolean;
  resume_banner_dismissed: boolean;
  inert: boolean;
  created_at: string;
  custom_name: string | null;
  /**
   * Single JSON column on `Chat` for the per-chat model tuple.
   * `null` ⇒ Loom defaults apply at (re)spawn time. The repo is the
   * single chokepoint — `get()` parses the stored JSON text into the
   * typed object; `update()` merge-patches over the current row JSON.
   */
  model_settings: WireModelSettings | null;
}

export interface ChatCreate {
  id: string;
  project_id?: string | null;
  cwd: string;
  permission_mode?: ChatRow["permission_mode"];
  worktree_mode?: ChatRow["worktree_mode"];
  worktree_path?: string | null;
  session_id?: string | null;
}

export interface ChatRepo {
  create(c: ChatCreate): ChatRow;
  get(id: string): ChatRow | null;
  list(): ChatRow[];
  listByProject(projectId: string): ChatRow[];
  update(id: string, patch: Partial<ChatRow>): ChatRow | null;
  delete(id: string): boolean;
  recentCwds(limit?: number): string[];
  setPid(id: string, pid: number | null): void;
  setSessionId(id: string, sessionId: string): void;
  /**
   * Bridge-owned field set at spawn time once the worktree is materialised.
   * Persisted so that cold loads (server restart between attaches) return
   * the path without waiting for the next attach to re-resolve it. The
   * value is safe to reuse on restart because `createWorktree` is
   * idempotent — a stale persisted path is verified on the next spawn
   * and overwritten if it no longer matches the chat's branch.
   */
  setWorktreePath(id: string, path: string | null): void;
  dismissResumeBanner(id: string): void;
  markInert(id: string): void;
  markActive(id: string): void;
  setCustomName(id: string, customName: string | null): ChatRow;
}

/** Parse the on-disk JSON column into the typed object; null on miss / malformed. */
function parseModelSettings(raw: unknown): WireModelSettings | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw as WireModelSettings;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as WireModelSettings;
  } catch {
    return null;
  }
}

export function chatRepo(storage: InMemoryStorage): ChatRepo {
  return {
    create(c) {
      const now = new Date().toISOString();
      // Pre-generate a session-id so we can pass `--session-id <uuid>` to
      // claude on spawn and tail the matching JSONL transcript without
      // racing claude's own session bookkeeping. Tests can still pass an
      // explicit session_id to pin a known value.
      const sessionId = c.session_id ?? generateSessionId();
      const row: ChatRow = {
        id: c.id,
        project_id: c.project_id ?? null,
        cwd: c.cwd,
        permission_mode: c.permission_mode ?? "default",
        worktree_mode: c.worktree_mode ?? "local",
        worktree_path: c.worktree_path ?? null,
        session_id: sessionId,
        pid: null,
        last_opened: now,
        pinned: false,
        resume_banner_dismissed: false,
        inert: false,
        created_at: now,
        custom_name: null,
        model_settings: null,
      };
      // Persist the JSON column as text-at-rest; parse on the way out.
      storage.chats.set(c.id, { ...row, model_settings: null });
      return row;
    },
    get(id) {
      const raw = storage.chats.get(id);
      if (!raw) return null;
      return { ...raw, model_settings: parseModelSettings(raw.model_settings) } as ChatRow;
    },
    list() {
      return Array.from(storage.chats.values());
    },
    listByProject(projectId) {
      return Array.from(storage.chats.values()).filter((c) => c.project_id === projectId);
    },
    update(id, patch) {
      const row = storage.chats.get(id);
      if (!row) return null;
      const next: any = { ...row, ...patch };
      // model_settings is a JSON column with merge-patch semantics: the
      // caller may pass a partial tuple and only the named fields land
      // on the row; unmentioned siblings survive. Stored as text-at-rest.
      if (Object.prototype.hasOwnProperty.call(patch, "model_settings")) {
        const incoming = (patch as Partial<ChatRow>).model_settings;
        if (incoming === null) {
          next.model_settings = null;
        } else {
          const current = parseModelSettings(row.model_settings) ?? {};
          next.model_settings = JSON.stringify({ ...current, ...incoming });
        }
      }
      storage.chats.set(id, next);
      return { ...next, model_settings: parseModelSettings(next.model_settings) } as ChatRow;
    },
    delete(id) {
      return storage.chats.delete(id);
    },
    recentCwds(limit = 20) {
      const seen = new Set<string>();
      const ordered = Array.from(storage.chats.values())
        .sort((a: any, b: any) => (b.last_opened > a.last_opened ? 1 : -1));
      const out: string[] = [];
      for (const r of ordered as any[]) {
        if (!seen.has(r.cwd)) {
          seen.add(r.cwd);
          out.push(r.cwd);
          if (out.length >= limit) break;
        }
      }
      return out;
    },
    setPid(id, pid) {
      const r = storage.chats.get(id);
      if (r) {
        r.pid = pid;
      }
    },
    setSessionId(id, sessionId) {
      const r = storage.chats.get(id);
      if (r) {
        r.session_id = sessionId;
      }
    },
    setWorktreePath(id, path) {
      const r = storage.chats.get(id);
      if (r) {
        r.worktree_path = path;
      }
    },
    dismissResumeBanner(id) {
      const r = storage.chats.get(id);
      if (r) r.resume_banner_dismissed = true;
    },
    markInert(id) {
      const r = storage.chats.get(id);
      if (r) {
        r.inert = true;
        r.pid = null;
      }
    },
    markActive(id) {
      const r = storage.chats.get(id);
      if (r) r.inert = false;
    },
    setCustomName(id, customName) {
      const r = storage.chats.get(id);
      if (!r) throw new Error("chat not found");
      r.custom_name = customName;
      return r;
    },
  };
}
