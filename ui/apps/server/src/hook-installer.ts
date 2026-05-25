/*
 * Hook installer — manages loom's receiver entries in ~/.claude/settings.json.
 *
 * Ownership model: a "loom-managed" hook entry is identified by its command
 * containing both the loopback host (127.0.0.1) and loom's receiver path
 * (/hooks/event). settings.json is parsed and rewritten as strict JSON —
 * no comment markers (Claude Code's settings parser rejects // comments).
 *
 * Pre-existing user hooks are preserved across install/uninstall: install
 * only adds/replaces loom's own entry within each wired event array;
 * uninstall removes only loom's entries (and prunes loom-only sub-hooks
 * from shared entries) leaving everything else intact.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const LOOM_HOST = "127.0.0.1";
const LOOM_HOOK_PATH = "/hooks/event";

export interface HookInstallerOptions {
  /** Path to settings.json. Defaults to ~/.claude/settings.json. */
  settingsPath?: string;
  /** Receiver port — usually loom-server's listen port (default 7891). */
  receiverPort?: number;
  /** Events to wire. Defaults to the canonical loom set. */
  events?: readonly string[];
}

// Canonical Claude Code hook event names. `PermissionRequest` is NOT a real
// Claude Code hook event — permission gating piggybacks on `PreToolUse`
// (the bridge filters by tool name; see hook-receiver/normalize.ts).
export const DEFAULT_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "SessionStart",
  "Stop",
  "SubagentStop",
] as const;

/**
 * Event keys that loom NEVER installs into but still purges loom-owned
 * entries from on every install/uninstall. Keeps the file clean if an
 * older loom version once installed under that event.
 */
const PURGE_ONLY_EVENTS = ["PermissionRequest"] as const;

export type DefaultEvent = (typeof DEFAULT_EVENTS)[number];

interface HookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}

/** Resolve settings.json path with sensible default. */
export function resolveSettingsPath(opts: HookInstallerOptions = {}): string {
  if (opts.settingsPath) return opts.settingsPath;
  const home = process.env.HOME ?? "";
  return path.join(home, ".claude", "settings.json");
}

/** Whether the settings file exists (might be empty if first-run). */
export function settingsExists(opts: HookInstallerOptions = {}): boolean {
  return fs.existsSync(resolveSettingsPath(opts));
}

/**
 * Inspect settings.json and return the set of event names that have at
 * least one loom-managed sub-hook. Returns an empty array if the file
 * is missing, empty, unparseable, or has no loom entries.
 *
 * This is the ground-truth complement to `DEFAULT_EVENTS` — diff the two
 * to detect installer drift (events the installer would write today but
 * that aren't currently in settings.json).
 */
export function detectInstalledEvents(opts: HookInstallerOptions = {}): string[] {
  const filePath = resolveSettingsPath(opts);
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim() === "") return [];
  const parsed = tryParse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const hooks = (parsed as { hooks?: Record<string, unknown> })?.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return [];
  const installed: string[] = [];
  for (const [evt, arr] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const hasLoom = (arr as HookEntry[]).some((entry) => countLoomCommands(entry) > 0);
    if (hasLoom) installed.push(evt);
  }
  return installed;
}

/**
 * Inspect settings.json. `hasMarker` means at least one loom-managed entry
 * was detected (identified by URL match). `hasUserHooks` means non-loom
 * hook entries exist outside loom's footprint.
 */
export function detectConflict(opts: HookInstallerOptions = {}): { hasMarker: boolean; hasUserHooks: boolean } {
  const filePath = resolveSettingsPath(opts);
  if (!fs.existsSync(filePath)) return { hasMarker: false, hasUserHooks: false };
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim() === "") return { hasMarker: false, hasUserHooks: false };
  const parsed = tryParse(text);
  if (parsed === undefined) {
    // Invalid JSON — surface as user-side state needing attention.
    return { hasMarker: false, hasUserHooks: true };
  }
  const hooks = (parsed as { hooks?: Record<string, unknown> })?.hooks;
  if (!hooks || typeof hooks !== "object") return { hasMarker: false, hasUserHooks: false };
  let hasMarker = false;
  let hasUserHooks = false;
  for (const arr of Object.values(hooks)) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr as HookEntry[]) {
      const loomCount = countLoomCommands(entry);
      const subCount = Array.isArray(entry?.hooks) ? entry.hooks.length : 0;
      if (loomCount > 0) hasMarker = true;
      // An entry contributes to "user hooks" if it isn't a pure loom entry.
      // A loom-only entry has all sub-hooks owned by loom (and at least one).
      const isPureLoomEntry = loomCount > 0 && loomCount === subCount;
      if (!isPureLoomEntry) hasUserHooks = true;
    }
  }
  return { hasMarker, hasUserHooks };
}

/**
 * Install loom's receiver into settings.json. Idempotent — replaces any
 * pre-existing loom entry with the current port/command. Pre-existing
 * non-loom hooks are preserved.
 */
export function install(opts: HookInstallerOptions = {}): { wroteFreshFile: boolean; appendedBelowExisting: boolean } {
  const filePath = resolveSettingsPath(opts);
  const port = opts.receiverPort ?? 7891;
  const events = opts.events ?? DEFAULT_EVENTS;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const exists = fs.existsSync(filePath);
  const text = exists ? fs.readFileSync(filePath, "utf8") : "";
  const isFresh = !exists || text.trim() === "";

  let parsed: Record<string, unknown> = {};
  if (!isFresh) {
    const candidate = tryParse(text);
    if (candidate === undefined) {
      throw new Error(
        `settings.json at ${filePath} is not valid JSON. Repair it (or delete it) before installing loom's hooks.`,
      );
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  }

  const hooks =
    parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
      ? (parsed.hooks as Record<string, unknown>)
      : {};

  let hadOtherHooks = false;
  for (const evt of events) {
    const existing = Array.isArray(hooks[evt]) ? (hooks[evt] as HookEntry[]) : [];
    const purged: HookEntry[] = [];
    for (const entry of existing) {
      const stripped = purgeLoomFromEntry(entry);
      if (stripped !== null) {
        purged.push(stripped);
        hadOtherHooks = true;
      }
    }
    purged.push(makeLoomEntry(port));
    hooks[evt] = purged;
  }

  // Purge-only sweep: never inject a loom entry, but strip any pre-existing
  // loom command (orphaned by older installer versions).
  for (const evt of PURGE_ONLY_EVENTS) {
    if (!Array.isArray(hooks[evt])) continue;
    const existing = hooks[evt] as HookEntry[];
    const cleaned: HookEntry[] = [];
    for (const entry of existing) {
      const stripped = purgeLoomFromEntry(entry);
      if (stripped !== null) cleaned.push(stripped);
    }
    hooks[evt] = cleaned;
  }
  parsed.hooks = hooks;

  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { wroteFreshFile: isFresh, appendedBelowExisting: hadOtherHooks };
}

/** Uninstall loom's entries. Pre-existing non-loom hooks are preserved. */
export function uninstall(opts: HookInstallerOptions = {}): { removed: boolean } {
  const filePath = resolveSettingsPath(opts);
  if (!fs.existsSync(filePath)) return { removed: false };
  const text = fs.readFileSync(filePath, "utf8");
  if (text.trim() === "") return { removed: false };
  const parsed = tryParse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { removed: false };
  const root = parsed as Record<string, unknown>;
  const hooks = root.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return { removed: false };
  const hookMap = hooks as Record<string, unknown>;

  let removed = false;
  for (const [evt, arr] of Object.entries(hookMap)) {
    if (!Array.isArray(arr)) continue;
    const next: HookEntry[] = [];
    for (const entry of arr as HookEntry[]) {
      const stripped = purgeLoomFromEntry(entry);
      if (stripped === null) {
        removed = true;
        continue;
      }
      if (stripped !== entry) removed = true;
      next.push(stripped);
    }
    hookMap[evt] = next;
  }
  if (!removed) return { removed: false };

  fs.writeFileSync(filePath, `${JSON.stringify(root, null, 2)}\n`);
  return { removed: true };
}

function makeLoomEntry(port: number): HookEntry {
  return {
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: `curl -s -X POST -H 'content-type: application/json' --data-binary @- http://${LOOM_HOST}:${port}${LOOM_HOOK_PATH}`,
      },
    ],
  };
}

function isLoomCommand(h: HookCommand | undefined | null): boolean {
  if (!h || h.type !== "command" || typeof h.command !== "string") return false;
  return h.command.includes(LOOM_HOST) && h.command.includes(LOOM_HOOK_PATH);
}

function countLoomCommands(entry: HookEntry | undefined | null): number {
  if (!entry || !Array.isArray(entry.hooks)) return 0;
  return entry.hooks.filter(isLoomCommand).length;
}

/**
 * Returns the entry with all loom-owned sub-hooks removed. Returns the
 * input unchanged if no loom hooks were present, or null if the entry
 * was loom-only and should be dropped entirely.
 */
function purgeLoomFromEntry(entry: HookEntry): HookEntry | null {
  if (!entry || !Array.isArray(entry.hooks)) return entry;
  const remaining = entry.hooks.filter((h) => !isLoomCommand(h));
  if (remaining.length === entry.hooks.length) return entry;
  if (remaining.length === 0) return null;
  return { ...entry, hooks: remaining };
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
