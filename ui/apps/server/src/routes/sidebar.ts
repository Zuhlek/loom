/**
 * GET /sidebar/state — returns chats + projects + looms grouped per SR-37.
 *
 * Looms are auto-discovered as `.loom/<name>/` directories inside each
 * project's paths. Each loom entry is shaped:
 *
 *   { id, projectId, projectName, name, cwd, dotLoomPath }
 *
 * The disk scan is cached briefly in-memory so back-to-back sidebar
 * refreshes don't hammer the filesystem. The cache is keyed per
 * (projectId, cwd) so individual project mutations don't blow away the
 * whole map. `invalidateLoomCache()` is exported for chat
 * create/delete to call when they may have changed loom state.
 */
import type { MetadataStore } from "../metadata-store/index.ts";
import { decorateChat } from "./chat-decorator.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const LOOM_TTL_MS = 2_000;

interface CachedLooms {
  at: number;
  entries: Array<{
    id: string;
    projectId: string;
    projectName: string;
    name: string;
    cwd: string;
    dotLoomPath: string;
    /**
     * Current phase parsed from `.loom/<name>/pipeline.md` — one of
     * "spec" | "design" | "plan" | "build" | "review", or null when the
     * file is missing/unparsable. Drives the colored dot in the sidebar.
     */
    phase: string | null;
    /**
     * Lifecycle state from `pipeline.md` — typically "active" or
     * "complete". When "complete" the sidebar dot renders gray
     * regardless of phase.
     */
    lifecycle: string | null;
  }>;
}

const loomCache = new Map<string, CachedLooms>(); // key = `${projectId}::${cwd}`

export function invalidateLoomCache(): void {
  loomCache.clear();
}

function shortHash(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

/**
 * Minimal `pipeline.md` reader — extracts the `Current phase` and
 * `Lifecycle state` fenced scalar bodies. Mirrors the parsing rules
 * used by `routes/loom.ts` (`## <Header>` sections + ```text``` fenced
 * bodies) but stays local to keep the sidebar scan cheap and avoid a
 * cross-route import. Returns `{ phase: null, lifecycle: null }` for
 * any missing/unreadable/unparsable file.
 */
function readPipelineFields(pipelinePath: string): {
  phase: string | null;
  lifecycle: string | null;
} {
  let text: string;
  try {
    text = fs.readFileSync(pipelinePath, "utf8");
  } catch {
    return { phase: null, lifecycle: null };
  }
  const headerRe = /^## ([^\n]+)\n/gm;
  const matches: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    matches.push({
      name: m[1].trim(),
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }
  const sections: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    sections[matches[i].name] = text.slice(matches[i].bodyStart, end);
  }
  const readFenced = (body: string | undefined): string | null => {
    if (!body) return null;
    const match = /```(?:text)?\n([\s\S]*?)\n```/.exec(body);
    const raw = match ? match[1] : body;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  };
  return {
    phase: readFenced(sections["Current phase"]),
    lifecycle: readFenced(sections["Lifecycle state"]),
  };
}

function scanLooms(
  projectId: string,
  projectName: string,
  cwd: string,
): CachedLooms["entries"] {
  const key = `${projectId}::${cwd}`;
  const cached = loomCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < LOOM_TTL_MS) return cached.entries;

  const entries: CachedLooms["entries"] = [];
  const loomDir = path.join(cwd, ".loom");
  if (fs.existsSync(loomDir)) {
    try {
      const dirents = fs.readdirSync(loomDir, { withFileTypes: true });
      for (const e of dirents) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith(".")) continue;
        const dotLoomPath = path.join(loomDir, e.name);
        const { phase, lifecycle } = readPipelineFields(
          path.join(dotLoomPath, "pipeline.md"),
        );
        entries.push({
          id: `${projectId}__${e.name}__${shortHash(cwd)}`,
          projectId,
          projectName,
          name: e.name,
          cwd,
          dotLoomPath,
          phase,
          lifecycle,
        });
      }
    } catch {
      // Permission errors etc — leave entries empty.
    }
  }
  loomCache.set(key, { at: now, entries });
  return entries;
}

export function mountSidebarRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/sidebar/state"] = async () => {
    const projects = store.projects.list();
    const chats = store.chats.list();
    const groups = projects.map((p) => {
      const groupChats = chats
        .filter((c: any) => c.project_id === p.id)
        .map((c) => decorateChat(c, store));
      const looms: CachedLooms["entries"] = [];
      for (const cwdPath of p.paths) {
        looms.push(...scanLooms(p.id, p.name, cwdPath));
      }
      return { project: p, chats: groupChats, looms };
    });
    // Unassigned chats → a synthetic "Unassigned" group at the end.
    const unassigned = chats
      .filter((c: any) => !c.project_id)
      .map((c) => decorateChat(c, store));
    return new Response(
      JSON.stringify({
        groups,
        unassigned,
        empty: groups.length === 0 && unassigned.length === 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}
