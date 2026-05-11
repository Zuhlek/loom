/**
 * Discover wizard service.
 *
 * Scans common parent directories for git repos containing
 * `.loom/<project>/`. Returns parents with detected sub-paths so
 * the wizard UI can present checkboxes.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface ScanResult {
  parent: string;
  exists: boolean;
  matches: { repoPath: string; loomProjects: string[] }[];
}

const DEFAULT_PARENTS = [
  os.homedir(),
  path.join(os.homedir(), "dev"),
  path.join(os.homedir(), "code"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "src"),
  path.join(os.homedir(), "Projects"),
];

const SCAN_DEPTH = 2;

export interface ScanOptions {
  parents?: string[];
  depth?: number;
}

export function scanCommonParents(opts: ScanOptions = {}): ScanResult[] {
  const parents = opts.parents ?? DEFAULT_PARENTS;
  const depth = opts.depth ?? SCAN_DEPTH;
  return parents.map((parent) => {
    if (!fs.existsSync(parent)) {
      return { parent, exists: false, matches: [] };
    }
    const matches: ScanResult["matches"] = [];
    walk(parent, depth, matches);
    return { parent, exists: true, matches };
  });
}

function walk(dir: string, depth: number, out: ScanResult["matches"]): void {
  if (depth < 0) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // Is this dir itself a git repo with .loom/?
  const gitMarker = path.join(dir, ".git");
  const loomDir = path.join(dir, ".loom");
  let loomProjects: string[] = [];
  if (fs.existsSync(gitMarker) && fs.existsSync(loomDir)) {
    try {
      loomProjects = fs
        .readdirSync(loomDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {}
    if (loomProjects.length > 0) {
      out.push({ repoPath: dir, loomProjects });
    }
  }
  if (depth === 0) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
    walk(path.join(dir, e.name), depth - 1, out);
  }
}

export function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(p);
}
