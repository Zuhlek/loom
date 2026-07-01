/**
 * Cwd routes.
 *
 *   GET /cwd/recent           — last N distinct cwds (used by spawn dialog).
 *   GET /cwd?parent=<abs|~>   — list visible directories under <parent>.
 *                               Returns: { entries: [{name, path, isDirectory, hasGit}] }
 *                               Rejects parents outside HOME.
 *   GET /cwd/roots            — common parent suggestions to seed the picker.
 *                               Returns: { roots: [{label, path}, ...] }
 *
 * For ~ as a sentinel: `parent=~` is treated as $HOME. Hidden dotfiles
 * are filtered. Symlinks are followed at file-stat time.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { MetadataStore } from "../metadata-store/index.ts";
import { jsonResponse } from "./_response.ts";
import { errorMessage } from "./_route-helpers.ts";

const HOME = os.homedir();

function resolveUnderHome(input: string): string | null {
  if (!input) return null;
  let abs = input;
  if (abs === "~") abs = HOME;
  else if (abs.startsWith("~/")) abs = path.join(HOME, abs.slice(2));
  abs = path.resolve(abs);
  // Must be HOME or strictly under it.
  if (abs !== HOME && !abs.startsWith(HOME + path.sep)) return null;
  return abs;
}

function isDirHasGit(p: string): boolean {
  try {
    return fs.existsSync(path.join(p, ".git"));
  } catch {
    return false;
  }
}

export function mountCwdRoute(
  routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>>,
  store: MetadataStore,
): void {
  routes["/cwd/recent"] = async (req, url) => {
    const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
    const cwds = store.chats.recentCwds(limit);
    return jsonResponse({ cwds }, 200);
  };

  routes["/cwd"] = async (req, url) => {
    const parentParam = url.searchParams.get("parent") ?? "~";
    const parent = resolveUnderHome(parentParam);
    if (!parent) {
      return jsonResponse(
        { error: "parent must be inside HOME", path: parentParam },
        400,
      );
    }
    let names: string[];
    try {
      names = fs.readdirSync(parent);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return jsonResponse(
          { error: "directory not found", path: parent, code },
          404,
        );
      }
      if (code === "EACCES" || code === "EPERM") {
        return jsonResponse(
          { error: "permission denied", path: parent, code },
          403,
        );
      }
      return jsonResponse(
        { error: `readdir failed: ${errorMessage(err)}`, path: parent },
        500,
      );
    }
    const entries: Array<{ name: string; path: string; isDirectory: boolean; hasGit: boolean }> = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(parent, name);
      let isDirectory = false;
      try {
        const st = fs.statSync(full);
        isDirectory = st.isDirectory();
      } catch {
        continue;
      }
      if (!isDirectory) continue;
      entries.push({
        name,
        path: full,
        isDirectory: true,
        hasGit: isDirHasGit(full),
      });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ parent, entries }, 200);
  };

  routes["/cwd/roots"] = async () => {
    const candidates: Array<{ label: string; rel: string }> = [
      { label: "home", rel: "" },
      { label: "dev", rel: "dev" },
      { label: "code", rel: "code" },
      { label: "src", rel: "src" },
      { label: "Documents", rel: "Documents" },
      { label: "Desktop", rel: "Desktop" },
      { label: "Projects", rel: "Projects" },
    ];
    const roots: Array<{ label: string; path: string }> = [];
    for (const c of candidates) {
      const full = c.rel ? path.join(HOME, c.rel) : HOME;
      try {
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
          roots.push({ label: c.label, path: full });
        }
      } catch {}
    }
    return jsonResponse({ home: HOME, roots }, 200);
  };
}
