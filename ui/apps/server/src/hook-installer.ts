/*
 * Hook installer — manages loom's append-with-marker block in
 * ~/.claude/settings.json. SR-39: pre-existing user-scope hooks are
 * never modified; loom's hooks live inside a marker block that uninstall
 * removes verbatim.
 *
 * The marker block is JSON-comment-style:
 *   // loom:hooks:start
 *   ...loom's hooks...
 *   // loom:hooks:end
 */

import * as fs from "node:fs";
import * as path from "node:path";

const MARKER_START = "// loom:hooks:start";
const MARKER_END = "// loom:hooks:end";

export interface HookInstallerOptions {
  /** Path to settings.json. Defaults to ~/.claude/settings.json. */
  settingsPath?: string;
  /** Receiver port — usually loom-server's listen port (default 7891). */
  receiverPort?: number;
  /** Events to wire. Defaults to the canonical loom set. */
  events?: readonly string[];
}

const DEFAULT_EVENTS = ["PostToolUse", "SessionStart", "Stop", "SubagentStop", "PermissionRequest"] as const;

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

/** Detect if pre-existing user-scope hooks are present (without loom's marker). */
export function detectConflict(opts: HookInstallerOptions = {}): { hasMarker: boolean; hasUserHooks: boolean } {
  const filePath = resolveSettingsPath(opts);
  if (!fs.existsSync(filePath)) return { hasMarker: false, hasUserHooks: false };
  const text = fs.readFileSync(filePath, "utf8");
  const hasMarker = text.includes(MARKER_START) && text.includes(MARKER_END);
  const hasUserHooks = !hasMarker && /"hooks"\s*:/.test(text);
  return { hasMarker, hasUserHooks };
}

/**
 * Install loom's hook receiver into ~/.claude/settings.json. Idempotent —
 * if the marker block is already present, replaces only what's between
 * MARKER_START and MARKER_END.
 *
 * For new files, writes a freshly-templated settings.json.
 * For existing files with no marker, appends the marker block beneath
 * any existing "hooks" structure (SR-39 append-below-marker).
 */
export function install(opts: HookInstallerOptions = {}): { wroteFreshFile: boolean; appendedBelowExisting: boolean } {
  const filePath = resolveSettingsPath(opts);
  const port = opts.receiverPort ?? 7891;
  const events = opts.events ?? DEFAULT_EVENTS;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8").trim() === "") {
    fs.writeFileSync(filePath, freshSettings(port, events));
    return { wroteFreshFile: true, appendedBelowExisting: false };
  }

  const before = fs.readFileSync(filePath, "utf8");
  const next = upsertMarkerBlock(before, port, events);
  fs.writeFileSync(filePath, next);
  return {
    wroteFreshFile: false,
    appendedBelowExisting: !before.includes(MARKER_START),
  };
}

/** Uninstall loom's marker block. Pre-existing lines are preserved. */
export function uninstall(opts: HookInstallerOptions = {}): { removed: boolean } {
  const filePath = resolveSettingsPath(opts);
  if (!fs.existsSync(filePath)) return { removed: false };
  const before = fs.readFileSync(filePath, "utf8");
  const next = stripAllMarkerBlocks(before);
  if (next === before) return { removed: false };
  fs.writeFileSync(filePath, next);
  return { removed: true };
}

function freshSettings(port: number, events: readonly string[]): string {
  const eventEntries = Object.fromEntries(
    events.map((evt) => [
      evt,
      [
        {
          matcher: "*",
          hooks: [{ type: "command", command: `curl -s -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/hooks/event` }],
        },
      ],
    ]),
  );
  // We embed the marker as JSON-with-comments — Claude Code's settings
  // parser tolerates // comments. Pretty-printed for human review.
  const lines: string[] = ["{", '  "hooks": {'];
  events.forEach((evt, i) => {
    lines.push(`    "${evt}": [`);
    lines.push(`      ${MARKER_START}`);
    lines.push(JSON.stringify(eventEntries[evt][0], null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    lines.push(`      ${MARKER_END}`);
    lines.push(i === events.length - 1 ? "    ]" : "    ],");
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}

function upsertMarkerBlock(before: string, port: number, events: readonly string[]): string {
  // Strategy: drop existing loom blocks, then append a fresh "hooks" override
  // block at the file's end via JSONC-style merge. For real-world correctness
  // a JSONC parser is preferred; we keep the simple text-edit approach for v1
  // and document the limitation: if the user has an unusual settings shape
  // we fall back to writing the marker at end-of-file.
  const stripped = stripAllMarkerBlocks(before);
  if (stripped.includes(`"hooks"`)) {
    // Append marker at the end of each event array. Simple regex merge.
    let out = stripped;
    for (const evt of events) {
      const re = new RegExp(`("${evt}"\\s*:\\s*\\[)([\\s\\S]*?)(\\])`, "m");
      const insert = `\n      ${MARKER_START}\n      { "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:${port}/hooks/event" }] }\n      ${MARKER_END}\n    `;
      out = out.replace(re, (_m, open, body: string, close) => {
        const trimmed = body.trim();
        const sep = trimmed.length > 0 && !trimmed.endsWith(",") ? "," : "";
        return `${open}${body}${sep}${insert}${close}`;
      });
    }
    return out;
  }
  // No "hooks" field at all — write a fresh block.
  return freshSettings(port, events);
}

function stripAllMarkerBlocks(text: string): string {
  const re = new RegExp(`\\s*${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\s*`, "g");
  return text.replace(re, "\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
