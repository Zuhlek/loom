/**
 * Smoke tests for the ChatPtyBridge — confirms attach spawns a child,
 * write forwards bytes, and the drain timer kicks in when the last
 * client detaches. Uses /bin/sh so we don't depend on `claude` being
 * installed in CI.
 */
import { describe, test, expect } from "bun:test";
import { initMetadataStore } from "../src/metadata-store/index.ts";
import { ChatPtyBridge } from "../src/process-manager/chat-pty-bridge.ts";

function makeFakeClient() {
  const messages: string[] = [];
  return {
    send(text: string) {
      messages.push(text);
    },
    messages,
  };
}

describe("ChatPtyBridge", () => {
  test("attach spawns a process and forwards stdout to the client", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c1", cwd: process.cwd() });
    const bridge = new ChatPtyBridge(store, {
      claudeBin: "/bin/echo",
      drainMs: 50,
      useHelper: false,
      disableTranscriptWatcher: true,
    });
    const client = makeFakeClient();
    bridge.attach(chat.id, client);

    // Wait for echo to print and exit. echo emits a line, then closes.
    await new Promise((r) => setTimeout(r, 200));

    const ptyOuts = client.messages.filter((m) => m.includes('"pty-out"'));
    expect(ptyOuts.length).toBeGreaterThan(0);
    await store.close();
  });

  test("detach starts the drain timer and clears pid eventually", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const chat = store.chats.create({ id: "c2", cwd: process.cwd() });
    const bridge = new ChatPtyBridge(store, {
      claudeBin: "/bin/sh",
      drainMs: 80,
      useHelper: false,
      disableTranscriptWatcher: true,
    });
    const client = makeFakeClient();
    bridge.attach(chat.id, client);
    bridge.detach(chat.id, client);

    // After drain interval the process should be SIGTERM'd; pid cleared.
    await new Promise((r) => setTimeout(r, 200));
    const updated = store.chats.get(chat.id);
    expect(updated?.inert).toBe(true);
    await store.close();
  });

  test("attach to non-existent chat throws", async () => {
    const store = await initMetadataStore({ inMemoryOnly: true });
    const bridge = new ChatPtyBridge(store, {
      claudeBin: "/bin/sh",
      useHelper: false,
      disableTranscriptWatcher: true,
    });
    const client = makeFakeClient();
    expect(() => bridge.attach("does-not-exist", client)).toThrow();
    await store.close();
  });
});
