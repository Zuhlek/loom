/**
 * API client. All endpoints go through Vite's `/api` proxy in dev; in
 * production a same-origin server would serve the bundle directly.
 */
import type { WireModelSettings } from "./chat-types";

const API_BASE = "/api";

/**
 * Liveness snapshot the sidebar uses to render a per-chat status
 * indicator. Server-supplied (sourced from the bridge's in-memory
 * `ChatSession`); `null` when no live session is attached.
 */
export interface ChatLiveState {
  turnState: "idle" | "running" | "interrupted" | "error";
  /** True while a permission request or AskUserQuestion is outstanding. */
  needsInput: boolean;
}

export interface ApiChat {
  id: string;
  project_id: string | null;
  cwd: string;
  permission_mode: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  /**
   * `null` until the first-send hook commits the chat's mode. Pre-commit
   * the composer renders the resolved `defaultEnvMode` from `/settings`
   * with a "(pending first-send)" qualifier.
   */
  worktree_mode: "local" | "worktree" | null;
  worktree_path: string | null;
  session_id: string | null;
  pid: number | null;
  last_opened: string;
  pinned: boolean;
  resume_banner_dismissed: boolean;
  inert: boolean;
  created_at: string;
  custom_name: string | null;
  auto_title: string | null;
  model_settings: WireModelSettings | null;
  /** Current branch checked out for this chat. */
  branch: string | null;
  /** Cached VCS kind for the chat's cwd; `null` for legacy rows pre-attach. */
  vcs_kind: "git" | "unknown" | null;
  /** Repo display name (git top-level basename); `null` when non-git / pre-attach. */
  repo_name: string | null;
  /** Live session state; `null` for inert / unattached chats. */
  live?: ChatLiveState | null;
}

export interface ApiProject {
  id: string;
  name: string;
  paths: string[];
  created_at: string;
}

export interface SidebarFabricEntry {
  /** Stable id: `<projectId>__<fabric-name>__<path-hash>`. */
  id: string;
  projectId: string;
  projectName: string;
  /** The fabric name (the directory name under .loom/). */
  name: string;
  /** Which of the project's paths this fabric sits under. */
  cwd: string;
  /** Absolute path to the .loom/<name>/ directory. */
  dotLoomPath: string;
  /**
   * Current phase parsed from `pipeline.md` — one of
   * "spec" | "design" | "plan" | "build" | "review", or null when the
   * file is missing/unparsable. Drives the colored sidebar dot.
   */
  phase: string | null;
  /**
   * Lifecycle state from `pipeline.md` — typically "active" or
   * "complete". When "complete" the sidebar dot renders gray
   * regardless of phase.
   */
  lifecycle: string | null;
}

export interface SidebarState {
  groups: Array<{
    project: ApiProject;
    chats: ApiChat[];
    fabrics: SidebarFabricEntry[];
  }>;
  unassigned: ApiChat[];
  empty: boolean;
}

/**
 * Error thrown by `apiFetch` for non-2xx responses. Exposes the parsed
 * JSON body (when available) so callers can render a clean message
 * instead of the wrapped "api /cwd 404: {...}" string.
 */
export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Canonical error → display string for every catch site in the web app.
 * ApiError already carries the server's cleaned `.error` field as its
 * message, so `.message` is the right thing to show; the branches below
 * cover plain Errors, thrown strings, and last-ditch unknowns.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || "request failed";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "request failed";
  }
}

async function apiFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + pathname, init);
  if (!res.ok) {
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const detail = parsed?.error ?? text;
    throw new ApiError(`${detail || res.statusText}`, res.status, parsed);
  }
  return (await res.json()) as T;
}

export async function getSidebarState(): Promise<SidebarState> {
  return apiFetch<SidebarState>("/sidebar/state");
}

export async function listChats(): Promise<{ chats: ApiChat[] }> {
  return apiFetch<{ chats: ApiChat[] }>("/chats");
}

export async function getChat(id: string): Promise<{ chat: ApiChat }> {
  return apiFetch<{ chat: ApiChat }>(`/chats/get?id=${encodeURIComponent(id)}`);
}

export interface CreateChatBody {
  cwd: string;
  permissionMode?: ApiChat["permission_mode"];
  worktreeMode?: ApiChat["worktree_mode"];
  /** New project-first contract: pin the chat to an existing project. */
  projectId?: string | null;
  /** Legacy: auto-create a project by name. UI no longer surfaces this. */
  projectName?: string;
}

export async function createChat(body: CreateChatBody): Promise<{ chat: ApiChat }> {
  return apiFetch<{ chat: ApiChat }>("/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface CreateProjectBody {
  name: string;
  initialCwd: string;
}

export async function createProject(body: CreateProjectBody): Promise<{ project: ApiProject }> {
  return apiFetch<{ project: ApiProject }>("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Launch a system terminal that re-attaches to the chat's PTY. */
export async function handoffChat(id: string): Promise<{ ok: true; command: string }> {
  return apiFetch<{ ok: true; command: string }>(
    `/chats/handoff?id=${encodeURIComponent(id)}`,
    { method: "POST" },
  );
}

/** Clone a chat row (same cwd / permission_mode / worktree_mode). */
export async function forkChat(id: string): Promise<{ chat: ApiChat }> {
  return apiFetch<{ chat: ApiChat }>(
    `/chats/fork?id=${encodeURIComponent(id)}`,
    { method: "POST" },
  );
}

export async function renameChat(
  id: string,
  customName: string | null,
): Promise<ApiChat> {
  const { chat } = await apiFetch<{ chat: ApiChat }>(
    `/chats/rename?id=${encodeURIComponent(id)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customName }),
    },
  );
  return chat;
}

export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chats/delete?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`api /chats/delete ${res.status}: ${await res.text()}`);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/delete?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`api /projects/delete ${res.status}: ${await res.text()}`);
  }
}

export interface ArchivedFabric {
  id: string;
  projectId: string;
  fabricName: string;
  cwd: string;
  archived_at: string;
}

export async function archiveFabric(input: {
  id: string;
  projectId: string;
  fabricName: string;
  cwd: string;
}): Promise<{ archived: ArchivedFabric }> {
  return apiFetch<{ archived: ArchivedFabric }>("/fabric/archive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function unarchiveFabric(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/fabric/unarchive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function listArchivedFabrics(): Promise<{ archived: ArchivedFabric[] }> {
  return apiFetch<{ archived: ArchivedFabric[] }>("/fabric/archived");
}

export interface CwdEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  hasGit: boolean;
}

export async function listCwd(parent: string): Promise<{ parent: string; entries: CwdEntry[] }> {
  return apiFetch<{ parent: string; entries: CwdEntry[] }>(
    `/cwd?parent=${encodeURIComponent(parent)}`,
  );
}

export async function listCwdRoots(): Promise<{ home: string; roots: Array<{ label: string; path: string }> }> {
  return apiFetch<{ home: string; roots: Array<{ label: string; path: string }> }>(
    "/cwd/roots",
  );
}

export async function listProjects(): Promise<{ projects: ApiProject[] }> {
  return apiFetch<{ projects: ApiProject[] }>("/projects");
}

export async function listRecentCwds(limit = 10): Promise<{ cwds: string[] }> {
  return apiFetch<{ cwds: string[] }>(`/cwd/recent?limit=${limit}`);
}

/**
 * GET /settings — Workspace + Worktrees + Auth panel data.
 *
 * Mirrors `ui/apps/server/src/routes/settings.ts` response shape.
 */
export interface ApiSettings {
  workspace: {
    root: string;
    source: string;
    /** Resolved default working-tree mode for new chats' first-send. */
    defaultEnvMode?: "local" | "worktree";
  };
  worktrees: { root: string | null };
  auth: {
    loggedIn: boolean;
    apiKeyDetected: boolean;
    apiKeyRejected: boolean;
    message?: string;
  };
}

export async function getSettings(): Promise<ApiSettings> {
  return apiFetch<ApiSettings>("/settings");
}

/** GET /api/health — used by the About panel and the offline poll. */
export interface ApiHealth {
  ok: boolean;
  version: string;
}

export async function getHealth(): Promise<ApiHealth> {
  return apiFetch<ApiHealth>("/health");
}

/** Resolve the WebSocket URL relative to the Vite dev server. */
export function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

// ---------------------------------------------------------------------------
// Git wire types and client functions
// ---------------------------------------------------------------------------

/** Response shape of `GET /git/status` (server: `routes/git-status.ts`). */
export interface ApiGitStatus {
  branch: string;
  base: string;
  ahead: number;
  behind: number;
  uncommitted: boolean;
  remote?: string;
}

/**
 * One section of `GET /diff` output (server: `routes/diff.ts`). One section
 * per repo in the workspace — the root repo plus any nested repos. `label` is
 * the repo path relative to the workspace root ("" for the root repo).
 */
export interface ApiDiffSection {
  kind: "whole";
  label: string;
  diff: string;
}

/** Response shape of `GET /diff`. */
export interface ApiDiffResponse {
  sections: ApiDiffSection[];
}

export async function getGitStatus(
  worktreePath: string,
  base?: string,
): Promise<ApiGitStatus> {
  // Omit `base` so the server resolves the repo's actual trunk (origin/HEAD →
  // main/master). Pass an explicit ref only to override.
  let qs = `worktreePath=${encodeURIComponent(worktreePath)}`;
  if (base) qs += `&base=${encodeURIComponent(base)}`;
  return apiFetch<ApiGitStatus>(`/git/status?${qs}`);
}

export async function getDiff(
  worktreePath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ApiDiffResponse> {
  // The diff base is resolved server-side (fork point of this branch/worktree),
  // so the client sends only the path.
  const qs = `worktreePath=${encodeURIComponent(worktreePath)}`;
  return apiFetch<ApiDiffResponse>(`/diff?${qs}`, { signal: opts.signal });
}

export async function postGitCommit(input: {
  worktreePath: string;
  message: string;
  body?: string;
  paths?: string[];
}): Promise<{ sha: string }> {
  return apiFetch<{ sha: string }>("/git/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function postGitPush(input: {
  worktreePath: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
}): Promise<{ ok: true } | { error: string }> {
  return apiFetch<{ ok: true } | { error: string }>("/git/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function postGitPr(input: {
  worktreePath: string;
  title: string;
  body?: string;
}): Promise<{ url: string }> {
  return apiFetch<{ url: string }>("/git/pr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

