/**
 * GET /loom/:projectId/:loomName
 *
 * Returns the live state of a loom directory:
 *   - pipeline:    parsed top-level scalars from `.pipeline` (YAML-ish).
 *                  Exposes only `current.phase`, `current.status`,
 *                  `approvals`, and `pending` (no deep recursion).
 *   - tree:        flat directory listing at depth ≤ 2, sorted
 *                  (directories first, then files, alphabetically).
 *   - artifacts:   contents of well-known markdown artifacts (idea.md,
 *                  plan.md, decisions.md, board.md, task.md, review.md,
 *                  summary.md, seed.md, constitution.md). Each capped
 *                  at 200 KB; truncated entries carry a marker tail.
 *   - events:      last 200 lines of `events.jsonl`, parsed.
 *   - mockupPages: filenames in the `mockup/` subdir (rendered via the
 *                  existing /loom/mockup/file iframe route).
 *
 * Behaviour:
 *  - 404 if the project id is unknown.
 *  - 404 if no project path contains a `.loom/<loomName>/` directory.
 *  - 1-second TTL cache keyed by (projectId, loomName) so rapid sidebar
 *    clicks don't repeatedly hit the disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { MetadataStore } from "../metadata-store/index.ts";

const ARTIFACT_FILES = [
  "idea.md",
  "decisions.md",
  "plan.md",
  "board.md",
  "task.md",
  "review.md",
  "summary.md",
  "seed.md",
  "constitution.md",
] as const;

const ARTIFACT_MAX_BYTES = 200 * 1024;
const EVENTS_TAIL_LINES = 200;
const TREE_MAX_DEPTH = 2;
const CACHE_TTL_MS = 1_000;

interface PipelineSummary {
  current: {
    phase: string | null;
    status: string | null;
  };
  approvals: Record<string, string | number | boolean | null>;
  pending: Record<string, unknown>;
}

interface LoomTreeEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

interface LoomViewResponse {
  projectId: string;
  projectName: string;
  loomName: string;
  loomDir: string;
  pipeline: PipelineSummary | null;
  tree: LoomTreeEntry[];
  artifacts: Record<string, string>;
  events: unknown[];
  mockupPages: string[];
}

interface CachedView {
  at: number;
  body: LoomViewResponse;
}

const cache = new Map<string, CachedView>();

export function invalidateLoomViewCache(): void {
  cache.clear();
}

/**
 * Minimal YAML scalar parser tailored for `.pipeline` files. We only
 * care about a flat set of top-level keys plus `current.phase` /
 * `current.status` / `approvals.*`. Anything deeper than that we
 * ignore — `pending` is exposed as a shallow Record and the caller
 * doesn't recurse into nested blobs.
 */
function parsePipeline(text: string): PipelineSummary {
  const lines = text.split(/\r?\n/);
  const summary: PipelineSummary = {
    current: { phase: null, status: null },
    approvals: {},
    pending: {},
  };
  let section: "current" | "approvals" | "pending" | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    // Top-level key (no leading whitespace).
    const topMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (topMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      const key = topMatch[1];
      const value = topMatch[2];
      if (key === "current" && (value === "" || value === undefined)) {
        section = "current";
        continue;
      }
      if (key === "approvals" && (value === "" || value === undefined)) {
        section = "approvals";
        continue;
      }
      if (key === "pending") {
        section = "pending";
        if (value && value !== "" && value !== "{}") {
          // Inline: ignore non-empty inline content for v1.
        }
        continue;
      }
      // Other top-level keys we don't surface for v1.
      section = null;
      continue;
    }
    // Indented (2 spaces) child of current section.
    const childMatch = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (childMatch && section) {
      const k = childMatch[1];
      const v = parseScalar(childMatch[2]);
      if (section === "current" && (k === "phase" || k === "status")) {
        summary.current[k] = typeof v === "string" ? v : v == null ? null : String(v);
      } else if (section === "approvals") {
        summary.approvals[k] = v as any;
      } else if (section === "pending") {
        summary.pending[k] = v;
      }
    }
  }
  return summary;
}

function parseScalar(raw: string): string | number | boolean | null {
  const v = raw.trim();
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "{}" || v === "[]") return null;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  // Strip surrounding quotes if present.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function readArtifact(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size <= ARTIFACT_MAX_BYTES) {
      return fs.readFileSync(filePath, "utf8");
    }
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(ARTIFACT_MAX_BYTES);
      fs.readSync(fd, buf, 0, ARTIFACT_MAX_BYTES, 0);
      return (
        buf.toString("utf8") +
        `\n\n[…truncated at ${ARTIFACT_MAX_BYTES} bytes; full size ${stat.size}]\n`
      );
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function listTree(dir: string, maxDepth: number): LoomTreeEntry[] {
  const out: LoomTreeEntry[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > maxDepth) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: LoomTreeEntry[] = [];
    const files: LoomTreeEntry[] = [];
    for (const e of dirents) {
      // Skip dotfiles other than .pipeline (which is informational data
      // already surfaced via the pipeline field).
      if (e.name.startsWith(".") && e.name !== ".pipeline") continue;
      const full = path.join(current, e.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const rel = path.relative(dir, full);
      const entry: LoomTreeEntry = {
        path: rel,
        name: e.name,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      };
      if (stat.isDirectory()) dirs.push(entry);
      else files.push(entry);
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      out.push(d);
      walk(path.join(dir, d.path), depth + 1);
    }
    for (const f of files) out.push(f);
  };
  walk(dir, 1);
  return out;
}

function tailEvents(filePath: string, n: number): unknown[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(-n);
  return lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
}

function listMockupPages(dir: string): string[] {
  const m = path.join(dir, "mockup");
  try {
    if (!fs.existsSync(m)) return [];
    return fs
      .readdirSync(m)
      .filter((f) => f.endsWith(".html"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve `.loom/<loomName>/` against a project's known paths. The
 * first hit wins so multi-path projects with overlapping loom names
 * fall back to first-listed wins (sidebar discovery uses the same
 * order, so this stays consistent with how the user clicked it).
 */
function resolveLoomDir(paths: string[], loomName: string): string | null {
  for (const p of paths) {
    const candidate = path.join(p, ".loom", loomName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function buildView(
  projectId: string,
  projectName: string,
  loomName: string,
  loomDir: string,
): LoomViewResponse {
  let pipeline: PipelineSummary | null = null;
  const pipelinePath = path.join(loomDir, ".pipeline");
  if (fs.existsSync(pipelinePath)) {
    try {
      pipeline = parsePipeline(fs.readFileSync(pipelinePath, "utf8"));
    } catch {
      pipeline = null;
    }
  }

  const artifacts: Record<string, string> = {};
  for (const name of ARTIFACT_FILES) {
    const content = readArtifact(path.join(loomDir, name));
    if (content != null) artifacts[name] = content;
  }

  const tree = listTree(loomDir, TREE_MAX_DEPTH);
  const events = tailEvents(path.join(loomDir, "events.jsonl"), EVENTS_TAIL_LINES);
  const mockupPages = listMockupPages(loomDir);

  return {
    projectId,
    projectName,
    loomName,
    loomDir,
    pipeline,
    tree,
    artifacts,
    events,
    mockupPages,
  };
}

export function mountLoomRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/loom/:projectId/:loomName"] = async (_req, url) => {
    // Pathname is /loom/<projectId>/<loomName>; segments[2] = id, [3] = name.
    const segs = url.pathname.split("/").filter((s) => s.length > 0);
    if (segs.length !== 3 || segs[0] !== "loom") {
      return jsonResponse({ error: "bad request" }, 400);
    }
    const projectId = decodeURIComponent(segs[1] ?? "");
    const loomName = decodeURIComponent(segs[2] ?? "");
    if (!projectId || !loomName) {
      return jsonResponse({ error: "missing projectId or loomName" }, 400);
    }
    // Path-traversal guard: loom name must be a single segment.
    if (loomName.includes("/") || loomName.includes("..")) {
      return jsonResponse({ error: "invalid loomName" }, 400);
    }

    const cacheKey = `${projectId}::${loomName}`;
    const cached = cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) {
      return jsonResponse(cached.body, 200);
    }

    const project = store.projects.get(projectId);
    if (!project) {
      return jsonResponse({ error: "project not found" }, 404);
    }

    const loomDir = resolveLoomDir(project.paths, loomName);
    if (!loomDir) {
      return jsonResponse({ error: "loom not found" }, 404);
    }

    const body = buildView(projectId, project.name, loomName, loomDir);
    cache.set(cacheKey, { at: now, body });
    return jsonResponse(body, 200);
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const __test__ = { parsePipeline, parseScalar, listTree, tailEvents };
