/**
 * Filesystem discovery of USER-invocable slash commands that never appear
 * in claude's JSONL `skill_listing` attachment.
 *
 * `skill_listing` is the MODEL-facing skill list, so a skill marked
 * `user-invocable: true` + `disable-model-invocation: true` (e.g. `/weave`)
 * is deliberately absent — the model can't invoke it, so claude hides it.
 * The interactive-TUI JSONL carries no other command listing (verified: no
 * `commands[]` line anywhere in a live transcript), and loom may not spawn
 * the Agent SDK / `claude -p` to read the init event the way t3code does.
 * So the only allowed source is the same dirs claude discovers from.
 *
 * We scan the SKILL.md / command dirs claude reads and surface the
 * user-invocable entries the model-facing catalog omits. The bridge merges
 * these into every `slash-commands-update` frame so the composer can
 * autocomplete them.
 *
 * ponytail: covers the two scopes that hold the reported gap — user-global
 * `~/.claude/{skills,commands}` (where `weave` lives as a symlink into
 * `orchestrator/`) and project-local `<cwd>/.claude/{skills,commands}`.
 * Plugin-cache skills are intentionally NOT scanned: plugin commands are
 * model-invocable, so they already arrive via `skill_listing`. Add plugin
 * scanning only if a user-only plugin command turns up missing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { WireSlashCommand } from "../../chat-protocol/messages.ts";

/** Parse the leading `---`…`---` YAML frontmatter into a flat string map.
 *  Values are split on the FIRST colon (descriptions contain colons), and
 *  surrounding quotes are stripped. Not a full YAML parser — SKILL.md
 *  frontmatter is flat key/value, so a line scan is enough (no new dep). */
function parseFrontmatter(text: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return out;
  const body = text.slice(text.indexOf("\n") + 1, end);
  for (const line of body.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

function listDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readFileSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Each `<dir>/<slug>/SKILL.md` → one command iff `user-invocable: true`. */
function scanSkillsDir(dir: string): WireSlashCommand[] {
  const out: WireSlashCommand[] = [];
  for (const entry of listDir(dir)) {
    const text = readFileSafe(join(dir, entry, "SKILL.md"));
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    if (fm.get("user-invocable") !== "true") continue;
    out.push({
      name: fm.get("name") || entry,
      description: fm.get("description") ?? "",
      argumentHint: fm.get("argument-hint") ?? "",
      kind: "skill",
    });
  }
  return out;
}

/** Each `<dir>/<name>.md` custom command. Custom commands are user commands
 *  by definition, so every `.md` becomes a command (frontmatter optional). */
function scanCommandsDir(dir: string): WireSlashCommand[] {
  const out: WireSlashCommand[] = [];
  for (const entry of listDir(dir)) {
    if (!entry.endsWith(".md")) continue;
    const fm = parseFrontmatter(readFileSafe(join(dir, entry)) ?? "");
    out.push({
      name: basename(entry, ".md"),
      description: fm.get("description") ?? "",
      argumentHint: fm.get("argument-hint") ?? "",
      kind: "command",
    });
  }
  return out;
}

/**
 * User-invocable commands discovered on disk for a chat's `cwd`, deduped by
 * name (project scope wins over user-global, matching claude's precedence).
 */
export function discoverUserSlashCommands(
  cwd: string,
  home: string = homedir(),
): WireSlashCommand[] {
  const found = [
    // Project scope first so it wins the dedupe.
    ...scanSkillsDir(join(cwd, ".claude", "skills")),
    ...scanCommandsDir(join(cwd, ".claude", "commands")),
    ...scanSkillsDir(join(home, ".claude", "skills")),
    ...scanCommandsDir(join(home, ".claude", "commands")),
  ];
  const byName = new Map<string, WireSlashCommand>();
  for (const cmd of found) {
    if (!cmd.name || byName.has(cmd.name)) continue;
    byName.set(cmd.name, cmd);
  }
  return [...byName.values()];
}

/**
 * Union of the model-facing catalog (`primary`, from `skill_listing`) and
 * the filesystem-discovered `extra`, deduped by name with `primary` winning
 * — its descriptions come straight from claude.
 */
export function mergeSlashCommands(
  primary: readonly WireSlashCommand[],
  extra: readonly WireSlashCommand[],
): WireSlashCommand[] {
  const names = new Set(primary.map((c) => c.name));
  return [...primary, ...extra.filter((c) => !names.has(c.name))];
}
