import { describe, test, expect } from "vitest";
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
