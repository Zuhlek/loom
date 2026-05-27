import { describe, test, expect, vi } from "vitest";
import { createTurnWatcher } from "../src/process-manager/turn-watcher.ts";

describe("TurnWatcher (T-015)", () => {
  test("assistant-message-terminus event → captureTurn called with chatId + turn number", () => {
    const captures: { chatId: string; turn: number; cwd: string }[] = [];
    const watcher = createTurnWatcher({
      onAssistantTurnComplete: (chatId, turn, cwd) => {
        captures.push({ chatId, turn, cwd });
      },
    });
    const sub = watcher.start("c1", "/p");
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    expect(captures).toEqual([
      { chatId: "c1", turn: 1, cwd: "/p" },
      { chatId: "c1", turn: 2, cwd: "/p" },
    ]);
    sub.stop();
  });

  test("malformed event → ignored, no crash", () => {
    const captures: any[] = [];
    const watcher = createTurnWatcher({
      onAssistantTurnComplete: (...args) => captures.push(args),
    });
    const sub = watcher.start("c1", "/p");
    // @ts-expect-error — intentional malformed event
    watcher.observeEvent(null);
    watcher.observeEvent({} as any);
    watcher.observeEvent({ chatId: "c1", kind: "user-turn" } as any);
    expect(captures).toHaveLength(0);
    sub.stop();
  });

  test("events for un-started chats are ignored", () => {
    const captures: any[] = [];
    const watcher = createTurnWatcher({
      onAssistantTurnComplete: (...args) => captures.push(args),
    });
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    expect(captures).toHaveLength(0);
  });

  test("stopped subscription stops receiving turn callbacks", () => {
    const captures: any[] = [];
    const watcher = createTurnWatcher({
      onAssistantTurnComplete: (...args) => captures.push(args),
    });
    const sub = watcher.start("c1", "/p");
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    sub.stop();
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    expect(captures).toHaveLength(1);
  });

  test("two chats are tracked independently", () => {
    const captures: any[] = [];
    const watcher = createTurnWatcher({
      onAssistantTurnComplete: (chatId, turn) => captures.push({ chatId, turn }),
    });
    watcher.start("c1", "/p");
    watcher.start("c2", "/p2");
    watcher.observeEvent({ chatId: "c1", kind: "assistant-turn-complete" });
    watcher.observeEvent({ chatId: "c2", kind: "assistant-turn-complete" });
    watcher.observeEvent({ chatId: "c2", kind: "assistant-turn-complete" });
    expect(captures).toEqual([
      { chatId: "c1", turn: 1 },
      { chatId: "c2", turn: 1 },
      { chatId: "c2", turn: 2 },
    ]);
  });
});
