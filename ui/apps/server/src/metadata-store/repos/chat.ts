/**
 * Chat repository.
 */
import * as crypto from "node:crypto";
import type { InMemoryStorage } from "../index.ts";

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
  dismissResumeBanner(id: string): void;
  markInert(id: string): void;
  markActive(id: string): void;
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
      };
      storage.chats.set(c.id, row);
      return row;
    },
    get(id) {
      return storage.chats.get(id) ?? null;
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
      const next = { ...row, ...patch };
      storage.chats.set(id, next);
      return next;
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
  };
}
