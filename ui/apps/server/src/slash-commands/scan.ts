/**
 * Slash-command scanner.
 *
 * Walks user-scope (`~/.claude/commands/`), project-scope
 * (`<cwd>/.claude/commands/`), and plugin-scope (best-effort) and
 * returns a deduped list with scope labels. Per plan.md Out-of-scope
 * "reimplementing slash-command semantics", nora ONLY collects names
 * — Claude Code itself executes them.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type Scope = "user" | "project" | "plugin";

export interface SlashCommand {
  name: string;
  scope: Scope;
  filePath: string;
}

function scanDir(dir: string, scope: Scope): SlashCommand[] {
  if (!fs.existsSync(dir)) return [];
  const out: SlashCommand[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".md")) continue;
    const name = e.name.replace(/\.md$/, "");
    out.push({ name, scope, filePath: path.join(dir, e.name) });
  }
  return out;
}

export function scanSlashCommands(cwd?: string): SlashCommand[] {
  const userDir = path.join(os.homedir(), ".claude", "commands");
  const projectDir = cwd ? path.join(cwd, ".claude", "commands") : null;
  const pluginsRoot = path.join(os.homedir(), ".claude", "plugins");
  const userCmds = scanDir(userDir, "user");
  const projectCmds = projectDir ? scanDir(projectDir, "project") : [];
  const pluginCmds: SlashCommand[] = [];
  if (fs.existsSync(pluginsRoot)) {
    try {
      const plugs = fs.readdirSync(pluginsRoot, { withFileTypes: true });
      for (const p of plugs) {
        if (!p.isDirectory()) continue;
        const cmdDir = path.join(pluginsRoot, p.name, "commands");
        pluginCmds.push(...scanDir(cmdDir, "plugin"));
      }
    } catch {}
  }
  // Dedup by name; project > user > plugin precedence (project wins).
  const seen = new Map<string, SlashCommand>();
  for (const c of pluginCmds) seen.set(c.name, c);
  for (const c of userCmds) seen.set(c.name, c);
  for (const c of projectCmds) seen.set(c.name, c);
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
