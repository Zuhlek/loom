import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initMetadataStore } from "../src/metadata-store/index.ts";

describe("metadata-store", () => {
  test("chat round-trip", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.projects.create({ id: "p1", name: "alpha", paths: ["/x"] });
    s.chats.create({ id: "c1", project_id: "p1", cwd: "/x" });
    expect(s.chats.get("c1")?.cwd).toBe("/x");
    expect(s.chats.listByProject("p1").length).toBe(1);
    s.chats.delete("c1");
    expect(s.chats.list().length).toBe(0);
    await s.close();
  });

  test("project paths add/remove", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const p = s.projects.create({ id: "p1", name: "alpha", paths: ["/x", "/y"] });
    s.projects.addPath(p.id, "/z");
    expect(s.projects.get(p.id)?.paths).toEqual(["/x", "/y", "/z"]);
    s.projects.addPath(p.id, "/y"); // dedup
    expect(s.projects.get(p.id)?.paths).toEqual(["/x", "/y", "/z"]);
    s.projects.removePath(p.id, "/y");
    expect(s.projects.get(p.id)?.paths).toEqual(["/x", "/z"]);
    await s.close();
  });

  test("pending-gate upsert is one row per (chatId, kind)", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.pendingGates.upsert({ chatId: "c1", kind: "askuserquestion", data: { v: 1 } });
    s.pendingGates.upsert({ chatId: "c1", kind: "askuserquestion", data: { v: 2 } });
    expect(s.pendingGates.list().length).toBe(1);
    expect(s.pendingGates.get("c1", "askuserquestion")?.data.v).toBe(2);
    s.pendingGates.delete("c1", "askuserquestion");
    expect(s.pendingGates.list().length).toBe(0);
    await s.close();
  });

  test("special characters round-trip", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const tricky = "alpha's \"name\" -- DROP";
    const p = s.projects.create({ id: "p1", name: tricky, paths: ["/o'connor"] });
    expect(s.projects.get(p.id)?.name).toBe(tricky);
    expect(s.projects.get(p.id)?.paths[0]).toBe("/o'connor");
    await s.close();
  });
});

describe("metadata-store — chat custom_name", () => {
  test("new chats default custom_name to null", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const row = s.chats.create({ id: "c1", cwd: "/x" });
    expect(row.custom_name).toBeNull();
    expect(s.chats.get("c1")?.custom_name).toBeNull();
    await s.close();
  });

  test("setCustomName stores the exact string passed without trimming", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    const updated = s.chats.setCustomName("c1", "  foo  ");
    expect(updated.custom_name).toBe("  foo  ");
    expect(s.chats.get("c1")?.custom_name).toBe("  foo  ");
    await s.close();
  });

  test("setCustomName(id, null) clears the field to null", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    s.chats.setCustomName("c1", "foo");
    s.chats.setCustomName("c1", null);
    expect(s.chats.get("c1")?.custom_name).toBeNull();
    await s.close();
  });

  test("setCustomName on unknown id throws 'chat not found' and does not mutate any row", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chats.create({ id: "c1", cwd: "/x" });
    s.chats.setCustomName("c1", "kept");
    expect(() => s.chats.setCustomName("missing-id", "foo")).toThrowError("chat not found");
    expect(s.chats.get("c1")?.custom_name).toBe("kept");
    expect(s.chats.list().length).toBe(1);
    await s.close();
  });

  test("setCustomName triggers the debounced persist path", async () => {
    const dbPath = path.join(os.tmpdir(), `loom-custom-name-persist-${process.pid}-${Date.now()}.json`);
    try {
      const s = await initMetadataStore({ pglitePath: dbPath });
      s.chats.create({ id: "c1", cwd: "/x" });
      s.chats.setCustomName("c1", "named");
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      const raw = fs.readFileSync(dbPath, "utf8");
      const parsed = JSON.parse(raw) as { chats: Array<{ id: string; custom_name: string | null }> };
      const persisted = parsed.chats.find((c) => c.id === "c1");
      expect(persisted?.custom_name).toBe("named");
      await s.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  test("serialize then hydrate round-trips custom_name byte-for-byte", async () => {
    const dbPath = path.join(os.tmpdir(), `loom-custom-name-roundtrip-${process.pid}-${Date.now()}.json`);
    try {
      const s1 = await initMetadataStore({ pglitePath: dbPath });
      s1.chats.create({ id: "c1", cwd: "/x" });
      s1.chats.setCustomName("c1", "foo");
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      await s1.close();

      const s2 = await initMetadataStore({ pglitePath: dbPath });
      expect(s2.chats.get("c1")?.custom_name).toBe("foo");
      await s2.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });

  test("legacy snapshot whose row omits custom_name hydrates the field as undefined", async () => {
    const dbPath = path.join(os.tmpdir(), `loom-custom-name-legacy-${process.pid}-${Date.now()}.json`);
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
      expect(row?.custom_name).toBeUndefined();
      const resolved = row?.custom_name ?? "fallback";
      expect(resolved).toBe("fallback");
      await s.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch {}
    }
  });
});
