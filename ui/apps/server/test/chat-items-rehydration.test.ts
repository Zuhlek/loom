/**
 * Chat-items rehydration — durable timeline survives drain/respawn.
 *
 * Before the chat-items repo existed, the bridge held the full
 * timeline only in `ChatSession.items` (in-memory). Once the drain
 * timer disposed the session — idle clients, server restart, or SDK
 * respawn after crash — those items were gone. The Claude SDK side
 * still remembered (it has its own server-side session log; the
 * `--resume` path replays history into the agent), so asking
 * "where do we stand?" got a coherent answer, but the UI showed
 * nothing. That asymmetry was the bug.
 *
 * The fix follows t3code's "thread is server-owned, event-sourced"
 * model: every appendItem/updateItem is mirrored into
 * `MetadataStore.chatItems`, and `spawn()` replays from there before
 * the bridge broadcasts the first snapshot.
 *
 * These tests pin the round-trip in three layers:
 *   1. The repo itself (append/update/list/clear semantics).
 *   2. The bridge mirrors live appendItem/updateItem into the repo.
 *   3. A cold attach against a fresh bridge built on the same store
 *      sees the previously persisted timeline.
 */
import { describe, expect, test } from "vitest";
import { initMetadataStore, type MetadataStore } from "../src/metadata-store/index.ts";
import { ClaudeSessionBridge } from "../src/process-manager/claude-session-bridge.ts";
import type {
  AssistantMessageItem,
  ChatItem,
  UserMessageItem,
} from "../src/chat-protocol/messages.ts";
import type { ServerFrame } from "../src/chat-protocol/frames.ts";

function makeAssistantItem(id: string, text: string): AssistantMessageItem {
  const now = new Date().toISOString();
  return {
    kind: "assistant-message",
    id,
    turnId: "t-1",
    blocks: [{ type: "text", text }],
    streaming: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeUserItem(id: string, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id,
    turnId: "t-1",
    text,
    createdAt: new Date().toISOString(),
  };
}

describe("chatItems repo — append/update/list/clear", () => {
  test("append preserves insertion order across two chats", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chatItems.append("chat-a", makeUserItem("u1", "hi"));
    s.chatItems.append("chat-b", makeUserItem("u2", "other"));
    s.chatItems.append("chat-a", makeAssistantItem("a1", "hello"));

    const a = s.chatItems.list("chat-a") as ChatItem[];
    expect(a.map((it) => it.id)).toEqual(["u1", "a1"]);
    const b = s.chatItems.list("chat-b") as ChatItem[];
    expect(b.map((it) => it.id)).toEqual(["u2"]);
    await s.close();
  });

  test("update mutates in place and keeps the original ordering", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chatItems.append("chat-x", makeUserItem("u1", "first"));
    s.chatItems.append("chat-x", makeAssistantItem("a1", "draft"));
    s.chatItems.append("chat-x", makeUserItem("u2", "second"));

    // Streaming-style update: same id, new text.
    s.chatItems.update("chat-x", makeAssistantItem("a1", "final"));

    const items = s.chatItems.list("chat-x") as ChatItem[];
    expect(items.map((it) => it.id)).toEqual(["u1", "a1", "u2"]);
    const middle = items[1] as AssistantMessageItem;
    expect(middle.blocks[0]).toMatchObject({ type: "text", text: "final" });
    await s.close();
  });

  test("update tolerates an unknown id (treats as append)", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chatItems.update("chat-y", makeAssistantItem("a99", "late arrival"));
    const items = s.chatItems.list("chat-y") as ChatItem[];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("a99");
    await s.close();
  });

  test("clear drops the chat's log without touching siblings", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    s.chatItems.append("chat-keep", makeUserItem("u1", "stay"));
    s.chatItems.append("chat-drop", makeUserItem("u2", "go"));
    s.chatItems.clear("chat-drop");
    expect(s.chatItems.list("chat-drop")).toHaveLength(0);
    expect(s.chatItems.list("chat-keep")).toHaveLength(1);
    await s.close();
  });
});

describe("bridge — mirrors live timeline into the chat-items log", () => {
  test("submitUserTurnWithPriority writes through to chatItems", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const bridge = new ClaudeSessionBridge(s, { drainMs: 0 });
    bridge.__test__installStubSession("chat-live-1", {});

    bridge.submitUserTurnWithPriority("chat-live-1", "hello world", "now");

    const persisted = s.chatItems.list("chat-live-1") as ChatItem[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.kind).toBe("user-message");
    expect((persisted[0] as UserMessageItem).text).toBe("hello world");
    await s.close();
  });
});

describe("bridge — cold attach rehydrates the timeline from chatItems", () => {
  test("a fresh bridge built on the same store sees previously persisted items in its snapshot", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    // Seed the durable log as though a prior bridge had broadcast
    // these items and then been disposed. We bypass the bridge here
    // and write straight to the repo — that's exactly the state we'd
    // observe after a server restart.
    s.chatItems.append("chat-cold", makeUserItem("u1", "where do we stand?"));
    s.chatItems.append(
      "chat-cold",
      makeAssistantItem("a1", "We finished the spec and started the design."),
    );

    // Stand up a chat row so the bridge's spawn() can find it.
    s.projects.create({ id: "p1", name: "alpha", paths: ["/tmp"] });
    s.chats.create({
      id: "chat-cold",
      project_id: "p1",
      cwd: "/tmp",
      // `inert: true` would route to the `--resume` path; either way
      // the hydration runs before startQuery, so we don't need a
      // working SDK here.
    });
    // Force-flag the row inert so we don't accidentally hit the
    // `create-new-session` startQuery branch with no real SDK present.
    s.chats.markInert("chat-cold");

    // Build a bridge AFTER the seed. This mirrors "loom server
    // restarted, no in-memory session map entry exists, the next
    // client to attach has to rebuild from disk."
    const bridge = new ClaudeSessionBridge(s, { drainMs: 0 });

    // We need to attach without letting startQuery actually run
    // (there's no Claude binary in test). Patch startQuery on the
    // instance to a no-op for this single test.
    const proto = Object.getPrototypeOf(bridge) as Record<string, unknown>;
    const origStart = proto.startQuery as (...args: unknown[]) => void;
    proto.startQuery = function noopStart() {};
    try {
      const frames: ServerFrame[] = [];
      const client = {
        send(text: string) {
          frames.push(JSON.parse(text) as ServerFrame);
        },
      };
      await bridge.attach("chat-cold", client);

      // The first frame back must be a snapshot carrying the seeded items.
      const snap = frames.find((f) => f.kind === "snapshot");
      expect(snap).toBeDefined();
      if (!snap || snap.kind !== "snapshot") throw new Error("unreachable");
      expect(snap.body.items.map((it) => it.id)).toEqual(["u1", "a1"]);

      // The session's in-memory items mirror the snapshot.
      const session = bridge.__test__sessions().get("chat-cold")!;
      expect(session.items.map((it) => it.id)).toEqual(["u1", "a1"]);

      // And the tool_use index is rebuilt (empty here, but the shape
      // assertion proves the hydration didn't leave it unset).
      expect(session.toolUseToAssistantId.size).toBe(0);
    } finally {
      proto.startQuery = origStart;
    }
    await s.close();
  });

  test("tool_use → assistant-id index is reconstructed from persisted tool_use blocks", async () => {
    const s = await initMetadataStore({ inMemoryOnly: true });
    const now = new Date().toISOString();
    const withToolUse: AssistantMessageItem = {
      kind: "assistant-message",
      id: "a-tu-1",
      turnId: "t-1",
      blocks: [
        { type: "text", text: "Let me check that file." },
        {
          type: "tool_use",
          id: "toolu_42",
          name: "Read",
          input: { path: "/x" },
          status: "complete",
        },
      ],
      streaming: false,
      createdAt: now,
      updatedAt: now,
    };
    s.chatItems.append("chat-tu", withToolUse);

    s.projects.create({ id: "p2", name: "beta", paths: ["/tmp"] });
    s.chats.create({ id: "chat-tu", project_id: "p2", cwd: "/tmp" });
    s.chats.markInert("chat-tu");

    const bridge = new ClaudeSessionBridge(s, { drainMs: 0 });
    const proto = Object.getPrototypeOf(bridge) as Record<string, unknown>;
    const origStart = proto.startQuery as (...args: unknown[]) => void;
    proto.startQuery = function noopStart() {};
    try {
      await bridge.attach("chat-tu", { send() {} });
      const session = bridge.__test__sessions().get("chat-tu")!;
      // The pivotal invariant: the index was rebuilt from the
      // persisted tool_use block, so a late tool_result echo on
      // resume can wire back to the right assistant message.
      expect(session.toolUseToAssistantId.get("toolu_42")).toBe("a-tu-1");
    } finally {
      proto.startQuery = origStart;
    }
    await s.close();
  });
});

describe("MetadataStore — JSON round-trip preserves the chat-items log", () => {
  test("serialize/hydrate restores per-chat ordering across an init cycle", async () => {
    // Use the on-disk path to exercise serialize → write → read →
    // hydrate. Vitest can run with a tmp dir; we use a unique path
    // under os.tmpdir to avoid cross-test interference.
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const dbPath = path.join(
      os.tmpdir(),
      `loom-chat-items-${process.pid}-${Date.now()}.json`,
    );
    try {
      const s1 = (await initMetadataStore({ pglitePath: dbPath })) as MetadataStore;
      s1.projects.create({ id: "p1", name: "alpha", paths: ["/x"] });
      s1.chats.create({ id: "c1", project_id: "p1", cwd: "/x" });
      s1.chatItems.append("c1", makeUserItem("u1", "first"));
      s1.chatItems.append("c1", makeAssistantItem("a1", "reply"));
      // Drive the persist tick (queueMicrotask in index.ts).
      await new Promise((r) => queueMicrotask(() => r(undefined)));
      await s1.close();

      const s2 = await initMetadataStore({ pglitePath: dbPath });
      const restored = s2.chatItems.list("c1") as ChatItem[];
      expect(restored.map((it) => it.id)).toEqual(["u1", "a1"]);
      await s2.close();
    } finally {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
    }
  });
});
