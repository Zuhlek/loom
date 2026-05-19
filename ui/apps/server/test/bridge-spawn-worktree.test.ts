/**
 * T-004 — Bridge spawn() resolves cwd via resolveSpawnCwd (US-002).
 *
 * Asserts that the bridge:
 *   - calls the injected resolveSpawnCwd helper with the chat + config,
 *   - uses the returned cwd as session.cwd before startQuery runs,
 *   - sets session.worktreePath,
 *   - updates the chat row's worktree_path via store.chats,
 *   - enqueues a system-notice timeline item when fallbackReason is
 *     non-null (and none when it's null).
 *
 * We exercise the public `attach()` entrypoint so the test mirrors
 * production wiring, but every dependency is stubbed: no real SDK
 * query is issued (the SDK call is intercepted via a startQuery
 * override on the constructor options).
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type { ResolvedSpawnCwd } from "../src/process-manager/resolve-spawn-cwd.ts";

function fakeClient() {
  const sent: unknown[] = [];
  return {
    send(frame: unknown) {
      sent.push(frame);
    },
    sent,
  } as any;
}

function makeBridgeWithStubs(
  store: any,
  resolved: ResolvedSpawnCwd,
) {
  const captured: { cwd?: string; calls: number } = { calls: 0 };
  const bridge = new ClaudeSessionBridge(store, {
    config: { worktreesRoot: null } as any,
    resolveSpawnCwd: async (_input) => {
      captured.calls++;
      return resolved;
    },
    startQueryOverride: (session) => {
      captured.cwd = session.cwd;
    },
  } as any);
  return { bridge, captured };
}

describe("T-004 bridge spawn integration", () => {
  test("local mode: session.cwd is the chat's bare cwd; no system-notice; worktree_path stays null", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: "/tmp/repo", worktree_mode: "local" });
    const { bridge, captured } = makeBridgeWithStubs(store, {
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: null,
    });
    await bridge.attach(chat.id, fakeClient());
    expect(captured.calls).toBe(1);
    expect(captured.cwd).toBe("/tmp/repo");
    const reloaded = store.chats.get(chat.id)!;
    expect(reloaded.worktree_path).toBeNull();
    // No system-notice was enqueued (timeline is just the snapshot).
    const items = store.chatItems.list(chat.id);
    const notices = items.filter((it: any) => it.kind === "system-notice");
    expect(notices.length).toBe(0);
    await store.close();
  });

  test("worktree-mode success: session.cwd is the worktree path; chat.worktree_path is set", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({
      id: "c2",
      cwd: "/tmp/repo",
      worktree_mode: "worktree",
    });
    const { bridge, captured } = makeBridgeWithStubs(store, {
      cwd: "/tmp/.loom-worktrees/c2/abcd1234",
      worktreePath: "/tmp/.loom-worktrees/c2/abcd1234",
      fallbackReason: null,
    });
    await bridge.attach(chat.id, fakeClient());
    expect(captured.cwd).toBe("/tmp/.loom-worktrees/c2/abcd1234");
    const reloaded = store.chats.get(chat.id)!;
    expect(reloaded.worktree_path).toBe("/tmp/.loom-worktrees/c2/abcd1234");
    await store.close();
  });

  test("worktree-mode fallback (not-a-repo): session.cwd stays at chat.cwd; system-notice is enqueued; worktree_path is null", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({
      id: "c3",
      cwd: "/tmp/repo",
      worktree_mode: "worktree",
    });
    const { bridge, captured } = makeBridgeWithStubs(store, {
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: "not-a-repo",
      fallbackDetail: "Worktree-mode requested but /tmp/repo is not a git repository.",
    });
    await bridge.attach(chat.id, fakeClient());
    expect(captured.cwd).toBe("/tmp/repo");
    const reloaded = store.chats.get(chat.id)!;
    expect(reloaded.worktree_path).toBeNull();
    const items = store.chatItems.list(chat.id);
    const notices = items.filter((it: any) => it.kind === "system-notice");
    expect(notices.length).toBe(1);
    expect((notices[0] as any).text).toMatch(/not a git repository/i);
    await store.close();
  });

  test("worktree-mode fallback (create-failed): system-notice carries the failure detail", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({
      id: "c4",
      cwd: "/tmp/repo",
      worktree_mode: "worktree",
    });
    const { bridge } = makeBridgeWithStubs(store, {
      cwd: "/tmp/repo",
      worktreePath: null,
      fallbackReason: "create-failed",
      fallbackDetail: "git worktree add failed: fatal: bad ref",
    });
    await bridge.attach(chat.id, fakeClient());
    const items = store.chatItems.list(chat.id);
    const notices = items.filter((it: any) => it.kind === "system-notice");
    expect(notices.length).toBe(1);
    expect((notices[0] as any).text).toMatch(/git worktree add failed/);
    await store.close();
  });
});
