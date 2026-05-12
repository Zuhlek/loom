/**
 * GET /loom/:projectId/:loomName — READ-ONLY.
 *
 * The phase pipeline this surface exposes is owned by `/weave`,
 * which is the only writer to `pipeline.md`. This route exposes
 * **no** POST / PATCH / PUT / DELETE mutators for the loom view;
 * non-GET requests return 405. See US-009 (AC4, AC5).
 *
 * Returns the live state of a loom directory:
 *   - pipeline:    parsed `pipeline.md` (markdown with `## Section`
 *                  headers and fenced ```text scalar bodies). Only
 *                  `current.phase` and `current.status` are surfaced.
 *   - tree:        flat directory listing at depth ≤ 2, sorted
 *                  (directories first, then files, alphabetically).
 *   - artifacts:   contents of every `.md` file in the tree, keyed by
 *                  the same relative path used in `tree`. Each capped
 *                  at 200 KB; truncated entries carry a marker tail.
 *   - mockupPages: filenames in the `mockup/` subdir (rendered via the
 *                  existing /loom/mockup/file iframe route).
 *
 * Behaviour:
 *  - 405 if the request method is not GET (the read-only contract).
 *  - 404 if the project id is unknown.
 *  - 404 if no project path contains a `.loom/<loomName>/` directory.
 *  - 1-second TTL cache keyed by (projectId, loomName) so rapid sidebar
 *    clicks don't repeatedly hit the disk.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { MetadataStore } from "../metadata-store/index.ts";

const ARTIFACT_MAX_BYTES = 200 * 1024;
const TREE_MAX_DEPTH = 2;
const CACHE_TTL_MS = 1_000;

interface PipelineSummary {
  current: {
    phase: string | null;
    status: string | null;
  };
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
 * Parser for `pipeline.md` written by `orchestrator/lib/pipeline-parser.py`.
 * Sections are introduced by `## <Name>` headers; scalar fields live in
 * fenced ```text blocks. We only surface `Current phase` and
 * `Phase status` — they drive the UI stepper. Anything else is left
 * for the artifact viewer to render as plain markdown.
 */
function parsePipeline(text: string): PipelineSummary {
  const sections = splitSections(text);
  const phase = readFenced(sections["Current phase"]);
  const status = readFenced(sections["Phase status"]);
  return {
    current: {
      phase: phase ?? null,
      status: status ?? null,
    },
  };
}

function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^## ([^\n]+)\n/gm;
  const matches: Array<{ name: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ name: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    out[matches[i].name] = text.slice(matches[i].bodyStart, end);
  }
  return out;
}

function readFenced(body: string | undefined): string | null {
  if (!body) return null;
  const match = /```(?:text)?\n([\s\S]*?)\n```/.exec(body);
  const raw = match ? match[1] : body;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
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
      if (e.name.startsWith(".")) continue;
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
  const pipelinePath = path.join(loomDir, "pipeline.md");
  if (fs.existsSync(pipelinePath)) {
    try {
      pipeline = parsePipeline(fs.readFileSync(pipelinePath, "utf8"));
    } catch {
      pipeline = null;
    }
  }

  const tree = listTree(loomDir, TREE_MAX_DEPTH);
  const artifacts: Record<string, string> = {};
  for (const entry of tree) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) continue;
    const content = readArtifact(path.join(loomDir, entry.path));
    if (content != null) artifacts[entry.path] = content;
  }

  const mockupPages = listMockupPages(loomDir);

  return {
    projectId,
    projectName,
    loomName,
    loomDir,
    pipeline,
    tree,
    artifacts,
    mockupPages,
  };
}

export function mountLoomRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/loom/:projectId/:loomName"] = async (req, url) => {
    // Read-only contract (US-009 AC4): any non-GET request returns
    // 405 — the phase pipeline is owned by /weave and the UI must
    // not mutate it via this surface.
    if (req.method !== "GET") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }
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

export const __test__ = { parsePipeline, listTree };
