/**
 * T-014 — Phase E PreToolUse hook install + receiver normalize.
 *
 * Gate: per `tasks/T-001.done.md`, permission prompts are NOT in JSONL
 * natively, so this task lands.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../src/hook-installer.ts";
import { normalizeHookEvent } from "../src/hook-receiver/normalize.ts";

describe("T-014 — installer includes PreToolUse", () => {
  it("install() writes a loom entry under hooks.PreToolUse", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-pretooluse-"));
    const settingsPath = join(dir, "settings.json");
    try {
      install({ settingsPath, receiverPort: 3737 });
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      const events = Object.keys(parsed.hooks);
      expect(events).toContain("PreToolUse");
      const entries = parsed.hooks.PreToolUse;
      expect(Array.isArray(entries)).toBe(true);
      const loomEntry = entries.find((e: any) =>
        Array.isArray(e?.hooks) &&
        e.hooks.some(
          (h: any) =>
            typeof h?.command === "string" && h.command.includes("/hooks/event"),
        ),
      );
      expect(loomEntry).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-running install() is idempotent (no duplicate PreToolUse entries)", () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-pretooluse-"));
    const settingsPath = join(dir, "settings.json");
    try {
      install({ settingsPath, receiverPort: 3737 });
      install({ settingsPath, receiverPort: 3737 });
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      const entries = parsed.hooks.PreToolUse;
      const loomEntries = entries.filter((e: any) =>
        Array.isArray(e?.hooks) &&
        e.hooks.some(
          (h: any) =>
            typeof h?.command === "string" && h.command.includes("/hooks/event"),
        ),
      );
      expect(loomEntries).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("T-014 — normalize(PreToolUse) yields a permission-prompt envelope", () => {
  it("normalises PreToolUse into a pre-tool-use envelope that the bridge routes to pending-permission", () => {
    const result = normalizeHookEvent({
      channel: "PreToolUse",
      chatId: "c-1",
      sessionId: "s-1",
      toolName: "Bash",
      toolArgs: { command: "ls" },
      payload: { id: "perm-pre-1", input: { command: "ls" }, toolUseId: "tu-9" },
    });
    expect(result.envelopes).toHaveLength(1);
    const env = result.envelopes[0]!;
    expect(env.kind).toBe("pre-tool-use");
    expect(env["chat-id"]).toBe("c-1");
    // The bridge consumes `env.body.payload` for the permission payload.
    const body = env.body as { toolName?: string; payload?: any };
    expect(body.toolName).toBe("Bash");
    expect(body.payload?.id).toBe("perm-pre-1");
  });
});
