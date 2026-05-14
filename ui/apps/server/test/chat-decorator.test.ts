import { describe, expect, test } from "vitest";
import { initMetadataStore, type MetadataStore } from "../src/metadata-store/index.ts";
import { decorateChat } from "../src/routes/chat-decorator.ts";
import type { ChatRow } from "../src/metadata-store/repos/chat.ts";
import type {
  AssistantMessageItem,
  PlanProposedItem,
  SystemNoticeItem,
  UserMessageItem,
} from "../src/chat-protocol/messages.ts";

function makeUserItem(id: string, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id,
    turnId: "t-1",
    text,
    createdAt: new Date().toISOString(),
  };
}

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

function makeSystemNotice(id: string, text: string): SystemNoticeItem {
  return {
    kind: "system-notice",
    id,
    text,
    level: "info",
    createdAt: new Date().toISOString(),
  };
}

function makePlanProposed(id: string): PlanProposedItem {
  return {
    kind: "plan-proposed",
    id,
    ts: Date.now(),
    planText: "do the thing",
    status: "pending",
  };
}

async function freshChat(): Promise<{ store: MetadataStore; chat: ChatRow }> {
  const store = await initMetadataStore({ inMemoryOnly: true });
  const chat = store.chats.create({ id: "chat-1", cwd: "/tmp/repo" });
  return { store, chat };
}

describe("decorateChat", () => {
  test("first user-message text surfaces as auto_title with whitespace collapsed", async () => {
    const { store, chat } = await freshChat();
    store.chatItems.append(chat.id, makeUserItem("u1", "  hello   world\n\nfriend  "));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBe("hello world friend");
    expect(decorated.id).toBe(chat.id);
    await store.close();
  });

  test("text longer than 60 visible chars truncates with trailing ellipsis at length 60", async () => {
    const { store, chat } = await freshChat();
    const longText = "x".repeat(200);
    store.chatItems.append(chat.id, makeUserItem("u1", longText));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).not.toBeNull();
    expect(decorated.auto_title!.length).toBe(60);
    expect(decorated.auto_title!.endsWith("…")).toBe(true);
    await store.close();
  });

  test("empty chatItems yields auto_title null", async () => {
    const { store, chat } = await freshChat();
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBeNull();
    await store.close();
  });

  test("only assistant / system / plan items yield auto_title null", async () => {
    const { store, chat } = await freshChat();
    store.chatItems.append(chat.id, makeAssistantItem("a1", "hi from claude"));
    store.chatItems.append(chat.id, makeSystemNotice("s1", "Resumed session"));
    store.chatItems.append(chat.id, makePlanProposed("p1"));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBeNull();
    await store.close();
  });

  test("leading empty user-message is skipped; next non-empty user-message wins", async () => {
    const { store, chat } = await freshChat();
    store.chatItems.append(chat.id, makeUserItem("u1", "   \n\t  "));
    store.chatItems.append(chat.id, makeUserItem("u2", "real prompt"));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBe("real prompt");
    await store.close();
  });

  test("with two non-empty user-messages, the first wins and the second is ignored", async () => {
    const { store, chat } = await freshChat();
    store.chatItems.append(chat.id, makeUserItem("u1", "first prompt"));
    store.chatItems.append(chat.id, makeUserItem("u2", "second prompt"));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBe("first prompt");
    await store.close();
  });

  test("slash-command prompt keeps the leading slash verbatim", async () => {
    const { store, chat } = await freshChat();
    store.chatItems.append(chat.id, makeUserItem("u1", "/weave foo"));
    const decorated = decorateChat(chat, store);
    expect(decorated.auto_title).toBe("/weave foo");
    await store.close();
  });

  test("chatItems.list returning undefined yields auto_title null without throwing", async () => {
    const { store, chat } = await freshChat();
    const fakeStore = {
      ...store,
      chatItems: {
        ...store.chatItems,
        list: () => undefined as unknown as unknown[],
      },
    } as MetadataStore;
    expect(() => decorateChat(chat, fakeStore)).not.toThrow();
    const decorated = decorateChat(chat, fakeStore);
    expect(decorated.auto_title).toBeNull();
    await store.close();
  });
});
