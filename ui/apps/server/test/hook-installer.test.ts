import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { install, uninstall, detectConflict, resolveSettingsPath } from "../src/hook-installer";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "nora-hook-"));
}

describe("hook-installer", () => {
  test("install on empty file writes a fresh settings.json with marker block", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const result = install({ settingsPath, receiverPort: 7891 });
    expect(result.wroteFreshFile).toBe(true);
    const content = readFileSync(settingsPath, "utf8");
    expect(content).toContain("// nora:hooks:start");
    expect(content).toContain("// nora:hooks:end");
    expect(content).toContain("127.0.0.1:7891/hooks");
    rmSync(dir, { recursive: true });
  });

  test("install on file with pre-existing user hooks appends marker block", () => {
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
    const content = readFileSync(settingsPath, "utf8");
    expect(content).toContain("user-existing");
    expect(content).toContain("// nora:hooks:start");
    expect(content).toContain("// nora:hooks:end");
    rmSync(dir, { recursive: true });
  });

  test("uninstall removes only nora's marker block, preserving user hooks", () => {
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
    const content = readFileSync(settingsPath, "utf8");
    expect(content).toContain("user-existing");
    expect(content).not.toContain("// nora:hooks:start");
    rmSync(dir, { recursive: true });
  });

  test("detectConflict returns hasUserHooks when a settings.json without marker exists", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Bash", hooks: [] }] } }),
    );
    const c = detectConflict({ settingsPath });
    expect(c.hasUserHooks).toBe(true);
    expect(c.hasMarker).toBe(false);
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

  test("install is idempotent — running twice keeps a single marker block", () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    install({ settingsPath, receiverPort: 7891 });
    install({ settingsPath, receiverPort: 7891 });
    const content = readFileSync(settingsPath, "utf8");
    const startCount = (content.match(/\/\/ nora:hooks:start/g) ?? []).length;
    // One per wired event
    expect(startCount).toBe(5);
    rmSync(dir, { recursive: true });
  });

  test("resolveSettingsPath defaults to ~/.claude/settings.json", () => {
    const home = process.env.HOME ?? "";
    expect(resolveSettingsPath()).toBe(path.join(home, ".claude", "settings.json"));
  });
});
