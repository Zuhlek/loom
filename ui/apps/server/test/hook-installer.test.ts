import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  install,
  uninstall,
  detectConflict,
  detectInstalledEvents,
  resolveSettingsPath,
  DEFAULT_EVENTS,
} from "../src/hook-installer";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "loom-hook-"));
}

const WIRED_EVENTS = [
  "PostToolUse",
  "PreToolUse",
  "SessionStart",
  "Stop",
  "SubagentStop",
  "PermissionRequest",
];

function loomEntryCount(parsed: any): number {
  let count = 0;
  for (const arr of Object.values(parsed?.hooks ?? {}) as any[]) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      const subs = (entry?.hooks ?? []) as any[];
      if (subs.some((h) => typeof h?.command === "string" && h.command.includes("/hooks/event"))) {
        count++;
      }
    }
  }
  return count;
}

describe("hook-installer", () => {
  test("install on empty file writes a valid-JSON settings.json with loom entries", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const result = install({ settingsPath, receiverPort: 7891 });
    expect(result.wroteFreshFile).toBe(true);
    const content = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(content);
    expect(content).toContain("127.0.0.1:7891/hooks/event");
    expect(loomEntryCount(parsed)).toBe(WIRED_EVENTS.length);
    rmSync(dir, { recursive: true });
  });

  test("install on file with pre-existing user hooks preserves them and adds loom entry", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-existing" }] }],
            SessionStart: [],
            Stop: [],
            SubagentStop: [],
            PermissionRequest: [],
          },
        },
        null,
        2,
      ),
    );
    const result = install({ settingsPath, receiverPort: 7891 });
    expect(result.appendedBelowExisting).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    const post = parsed.hooks.PostToolUse;
    expect(post).toHaveLength(2);
    expect(post[0]).toEqual({ matcher: "Bash", hooks: [{ type: "command", command: "user-existing" }] });
    expect(post[1].hooks[0].command).toContain("127.0.0.1:7891/hooks/event");
    rmSync(dir, { recursive: true });
  });

  test("uninstall removes only loom's entries, preserving user hooks", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-existing" }] }],
            SessionStart: [],
            Stop: [],
            SubagentStop: [],
            PermissionRequest: [],
          },
        },
        null,
        2,
      ),
    );
    install({ settingsPath, receiverPort: 7891 });
    const removed = uninstall({ settingsPath });
    expect(removed.removed).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(parsed.hooks.PostToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "user-existing" }] },
    ]);
    expect(loomEntryCount(parsed)).toBe(0);
    rmSync(dir, { recursive: true });
  });

  test("uninstall on a shared entry prunes only the loom sub-hook", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "*",
              hooks: [
                { type: "command", command: "user-side" },
                { type: "command", command: "curl http://127.0.0.1:7891/hooks/event" },
              ],
            },
          ],
        },
      }),
    );
    const result = uninstall({ settingsPath });
    expect(result.removed).toBe(true);
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(parsed.hooks.PostToolUse).toEqual([
      { matcher: "*", hooks: [{ type: "command", command: "user-side" }] },
    ]);
    rmSync(dir, { recursive: true });
  });

  test("detectConflict returns hasUserHooks when settings.json has only user hooks", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] } }),
    );
    const c = detectConflict({ settingsPath });
    expect(c.hasUserHooks).toBe(true);
    expect(c.hasMarker).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("detectConflict returns hasMarker after install", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    const c = detectConflict({ settingsPath });
    expect(c.hasMarker).toBe(true);
    expect(c.hasUserHooks).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("detectConflict on missing file returns no conflict", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "missing.json");
    const c = detectConflict({ settingsPath });
    expect(c.hasMarker).toBe(false);
    expect(c.hasUserHooks).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("install is idempotent — repeated runs keep exactly one loom entry per event", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    install({ settingsPath, receiverPort: 7891 });
    install({ settingsPath, receiverPort: 7891 });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(loomEntryCount(parsed)).toBe(WIRED_EVENTS.length);
    rmSync(dir, { recursive: true });
  });

  test("install replaces an old loom entry when the receiver port changes", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    install({ settingsPath, receiverPort: 9999 });
    const content = readFileSync(settingsPath, "utf8");
    expect(content).not.toContain("127.0.0.1:7891");
    expect(content).toContain("127.0.0.1:9999/hooks/event");
    const parsed = JSON.parse(content);
    expect(loomEntryCount(parsed)).toBe(WIRED_EVENTS.length);
    rmSync(dir, { recursive: true });
  });

  test("install refuses to overwrite an invalid-JSON settings.json", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, "{ not json");
    expect(() => install({ settingsPath, receiverPort: 7891 })).toThrow(/not valid JSON/);
    rmSync(dir, { recursive: true });
  });

  test("install always produces strict-JSON output (no JSONC marker comments)", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    const content = readFileSync(settingsPath, "utf8");
    expect(content).not.toContain("loom:hooks:start");
    expect(content).not.toContain("loom:hooks:end");
    // Round-trip parse must succeed — that's the real contract.
    expect(() => JSON.parse(content)).not.toThrow();
    rmSync(dir, { recursive: true });
  });

  test("install purges orphan loom entries from PermissionRequest while preserving non-loom hooks", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            PermissionRequest: [
              {
                matcher: "*",
                hooks: [
                  { type: "command", command: "curl http://127.0.0.1:7891/hooks/event" },
                ],
              },
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "user-perm-script.sh" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    install({ settingsPath, receiverPort: 7891 });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    const perm = parsed.hooks.PermissionRequest;
    expect(Array.isArray(perm)).toBe(true);
    // Non-loom hook is preserved.
    expect(perm).toContainEqual({
      matcher: "Bash",
      hooks: [{ type: "command", command: "user-perm-script.sh" }],
    });
    // No loom command remains under PermissionRequest.
    for (const entry of perm) {
      for (const h of entry.hooks ?? []) {
        expect(typeof h.command === "string" && h.command.includes("/hooks/event")).toBe(false);
      }
    }
    rmSync(dir, { recursive: true });
  });

  test("resolveSettingsPath defaults to ~/.claude/settings.json", () => {
    const home = process.env.HOME ?? "";
    expect(resolveSettingsPath()).toBe(path.join(home, ".claude", "settings.json"));
  });
});

describe("detectInstalledEvents", () => {
  test("returns empty list when settings.json is missing", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    expect(detectInstalledEvents({ settingsPath })).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  test("returns empty list when settings.json has no loom entries", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "user-only" }] }],
        },
      }),
    );
    expect(detectInstalledEvents({ settingsPath })).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  test("returns the full event set after install()", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    const installed = detectInstalledEvents({ settingsPath });
    expect(installed.sort()).toEqual([...DEFAULT_EVENTS].sort());
    rmSync(dir, { recursive: true });
  });

  test("returns only the events that still have a loom entry after partial uninstall", () => {
    // Simulates drift: install today's events, then hand-edit settings to drop one.
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as any;
    delete parsed.hooks.PreToolUse;
    delete parsed.hooks.Notification;
    writeFileSync(settingsPath, JSON.stringify(parsed));
    const installed = detectInstalledEvents({ settingsPath });
    expect(installed).not.toContain("PreToolUse");
    expect(installed).not.toContain("Notification");
    expect(installed).toContain("PostToolUse");
    expect(installed).toContain("Stop");
    rmSync(dir, { recursive: true });
  });

  test("ignores user-only sub-hooks but counts events that also have a loom sub-hook", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as any;
    parsed.hooks.PostToolUse.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: "user-only-script.sh" }],
    });
    writeFileSync(settingsPath, JSON.stringify(parsed));
    const installed = detectInstalledEvents({ settingsPath });
    expect(installed).toContain("PostToolUse");
    rmSync(dir, { recursive: true });
  });

  test("tolerates malformed JSON without throwing", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, "{ not json");
    expect(() => detectInstalledEvents({ settingsPath })).not.toThrow();
    expect(detectInstalledEvents({ settingsPath })).toEqual([]);
    rmSync(dir, { recursive: true });
  });
});
