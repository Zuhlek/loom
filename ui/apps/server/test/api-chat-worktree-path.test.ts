/**
 * T-004 — ApiChat exposes worktree_path (US-002).
 *
 * The bridge writes worktree_path onto the chat row via
 * store.chats.setWorktreePath; this test asserts the field is
 * surfaced on GET /chats (the route serialises store.chats.list()
 * verbatim).
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { mountChatsRoute } from "../src/routes/chats.ts";

describe("T-004 ApiChat worktree_path", () => {
  test("setWorktreePath mutator updates the chat row and surfaces on GET /chats", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo", worktree_mode: "worktree" });
    expect(chat.worktree_path).toBeNull();
    // Repo mutator from T-004.
    store.chats.setWorktreePath(chat.id, "/tmp/.loom-worktrees/c1/abcd1234");
    const routes: Record<string, any> = {};
    mountChatsRoute(routes, store);
    const req = new Request("http://localhost/chats");
    const res = await routes["/chats"](req, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.chats.find((c: any) => c.id === chat.id);
    expect(row).toBeDefined();
    expect(row.worktree_path).toBe("/tmp/.loom-worktrees/c1/abcd1234");
    await store.close();
  });

  test("setWorktreePath(null) clears the field (used when worktree-mode falls back)", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c2", cwd: "/tmp/repo", worktree_mode: "worktree" });
    store.chats.setWorktreePath(chat.id, "/tmp/wt");
    store.chats.setWorktreePath(chat.id, null);
    const reloaded = store.chats.get(chat.id)!;
    expect(reloaded.worktree_path).toBeNull();
    await store.close();
  });
});
