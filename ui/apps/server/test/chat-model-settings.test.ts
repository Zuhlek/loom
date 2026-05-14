/**
 * T-002 — Chat-row `model_settings` JSON column.
 *
 * Covers the single chokepoint in `chatRepo`: parse on `get`, merge-patch
 * on `update`. NULL column → in-memory `null` so the bridge falls back to
 * Loom defaults at (re)spawn time. Migration file must be present so
 * `initMetadataStore` lists it (read-only parseability check today).
 */
import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import type { WireModelSettings } from "../src/chat-protocol/messages.ts";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "metadata-store",
  "migrations",
);

describe("metadata-store — chat model_settings", () => {
  test("migration 002_model_settings.sql is present and adds the column", () => {
    const file = path.join(MIGRATIONS_DIR, "002_model_settings.sql");
    expect(fs.existsSync(file)).toBe(true);
    const sql = fs.readFileSync(file, "utf8");
    expect(/ALTER\s+TABLE\s+Chat/i.test(sql)).toBe(true);
    expect(/ADD\s+COLUMN\s+model_settings/i.test(sql)).toBe(true);
  });

  test("new chats default model_settings to null", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    expect(s.chats.get("c1")?.model_settings).toBeNull();
    await s.close();
  });

  test("legacy snapshot whose row omits model_settings reads as null", async () => {
    const dbPath = path.join(
      require("node:os").tmpdir(),
      `loom-model-settings-legacy-${process.pid}-${Date.now()}.json`,
    );
    try {
      const legacy = {
        chats: [
          {
            id: "c-legacy",
            project_id: null,
            cwd: "/x",
            permission_mode: "default",
            worktree_mode: "local",
            worktree_path: null,
            session_id: "00000000-0000-0000-0000-000000000000",
            pid: null,
            last_opened: new Date().toISOString(),
            pinned: false,
            resume_banner_dismissed: false,
            inert: false,
            created_at: new Date().toISOString(),
          },
        ],
        projects: [],
        pendingGates: [],
        hookRegistrations: [],
      };
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(dbPath, JSON.stringify(legacy), "utf8");
      const s = await initMetadataStore({ pglitePath: dbPath });
      const row = s.chats.get("c-legacy");
      expect(row).not.toBeNull();
      expect(row?.model_settings).toBeNull();
      await s.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  test("update with a full tuple round-trips through get", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    const tuple: WireModelSettings = {
      model: "claude-opus-4-7",
      effort: "xhigh",
      thinking: null,
      contextWindow: "200k",
    };
    s.chats.update("c1", { model_settings: tuple });
    expect(s.chats.get("c1")?.model_settings).toEqual(tuple);
    await s.close();
  });

  test("partial patch merges over existing JSON; siblings survive", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    s.chats.update("c1", {
      model_settings: {
        model: "claude-opus-4-7",
        effort: "xhigh",
        thinking: null,
        contextWindow: "200k",
      },
    });
    // Patch only `model` — other fields must survive.
    s.chats.update("c1", { model_settings: { model: "claude-sonnet-4-6" } as Partial<WireModelSettings> as WireModelSettings });
    expect(s.chats.get("c1")?.model_settings).toEqual({
      model: "claude-sonnet-4-6",
      effort: "xhigh",
      thinking: null,
      contextWindow: "200k",
    });
    // Patch only `contextWindow` — earlier `model` + `effort` must survive.
    s.chats.update("c1", { model_settings: { contextWindow: "1m" } as Partial<WireModelSettings> as WireModelSettings });
    expect(s.chats.get("c1")?.model_settings).toEqual({
      model: "claude-sonnet-4-6",
      effort: "xhigh",
      thinking: null,
      contextWindow: "1m",
    });
    await s.close();
  });

  test("update with model_settings on a row whose JSON is null seeds the row", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    expect(s.chats.get("c1")?.model_settings).toBeNull();
    s.chats.update("c1", {
      model_settings: { contextWindow: "1m" } as Partial<WireModelSettings> as WireModelSettings,
    });
    expect(s.chats.get("c1")?.model_settings).toEqual({
      contextWindow: "1m",
    });
    await s.close();
  });
});
