/**
 * F2 — optimistic user-bubble reducer behaviour.
 *
 * The live-chat composer used to clear on send and then show nothing
 * until the server round-tripped the turn back as an `item-append`
 * (~537ms of dead air on a warm session, much longer on cold start).
 * F2 inserts a synchronous optimistic `user-message` placeholder on
 * send and reconciles it FIFO when the real echo arrives.
 *
 * These are pure unit tests against the exported `chatReducer` /
 * `EMPTY_STATE` — same node-environment vitest tier as
 * `timeline-rows.test.ts`. They prove:
 *   (a) the `optimistic-user` dispatch adds a "sending" item;
 *   (b) a server user `item-append` reconciles to exactly one bubble;
 *   (c) two rapid sends reconcile FIFO as two echoes arrive;
 *   (d) `snapshot` / `reset` clear optimistic items;
 *   (e) a `turn-state: error` marks a pending item "failed".
 *
 * A small static-source check also pins the `MessagesTimeline`
 * "sending"/"failed" render contract and the `submitTurn` optimistic
 * dispatch, matching the file's contract-test convention.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  chatReducer,
  EMPTY_STATE,
  OPTIMISTIC_ID_PREFIX,
  type ChatState,
} from "../src/routes/live-chat";
import type {
  ChatItem,
  ChatSnapshot,
  ServerFrame,
  UserMessageItem,
} from "../src/lib/chat-types";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

function optimistic(seq: number, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id: `${OPTIMISTIC_ID_PREFIX}${seq}`,
    turnId: `${OPTIMISTIC_ID_PREFIX}${seq}`,
    text,
    createdAt: "2026-06-04T10:00:00.000Z",
    pending: "sending",
  };
}

function serverUser(id: string, text: string): UserMessageItem {
  return {
    kind: "user-message",
    id,
    turnId: "turn-1",
    text,
    createdAt: "2026-06-04T10:00:01.000Z",
  };
}

function userItems(state: ChatState): UserMessageItem[] {
  return state.items.filter(
    (it): it is UserMessageItem => it.kind === "user-message",
  );
}

describe("F2 (a) — optimistic-user dispatch adds a 'sending' item", () => {
  test("inserts the placeholder synchronously, flagged sending", () => {
    const item = optimistic(0, "hello world");
    const next = chatReducer(EMPTY_STATE, { type: "optimistic-user", item });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      kind: "user-message",
      text: "hello world",
      pending: "sending",
    });
    // itemsById tracks the new index so a same-id append would be a no-op.
    expect(next.itemsById[item.id]).toBe(0);
  });

  test("optimistic id never collides with the server duplicate-id guard", () => {
    const item = optimistic(0, "hi");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item });
    // A server item with a DIFFERENT id appends rather than dedupes.
    const echo = serverUser("server-1", "hi");
    const s2 = chatReducer(s1, { type: "item-append", item: echo });
    expect(userItems(s2)).toHaveLength(1);
  });
});

describe("F2 (b) — server echo reconciles to exactly one bubble", () => {
  test("the optimistic placeholder is replaced in-place by the real item", () => {
    const opt = optimistic(0, "do the thing");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    // Server may rewrite the text (e.g. append @<absPath> image tokens);
    // reconcile must NOT rely on text equality.
    const echo = serverUser("server-1", "do the thing @/abs/img.png");
    const s2 = chatReducer(s1, { type: "item-append", item: echo });
    const users = userItems(s2);
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe("server-1");
    expect(users[0]!.pending).toBeUndefined();
    // Replaced in the same slot — no duplicate, indices rebuilt.
    expect(s2.items).toHaveLength(1);
    expect(s2.itemsById["server-1"]).toBe(0);
    expect(s2.itemsById[opt.id]).toBeUndefined();
  });

  test("a server user-message with no pending placeholders just appends", () => {
    const echo = serverUser("server-1", "first turn");
    const s1 = chatReducer(EMPTY_STATE, { type: "item-append", item: echo });
    expect(userItems(s1)).toHaveLength(1);
    expect(s1.items[0]!.id).toBe("server-1");
  });
});

describe("F2 (c) — two rapid sends reconcile FIFO", () => {
  test("each server echo drops the OLDEST pending placeholder", () => {
    const a = optimistic(0, "first");
    const b = optimistic(1, "second");
    let s = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: a });
    s = chatReducer(s, { type: "optimistic-user", item: b });
    expect(userItems(s)).toHaveLength(2);

    // First echo reconciles the OLDEST ("first") placeholder.
    const echo1 = serverUser("srv-1", "first (rewritten)");
    s = chatReducer(s, { type: "item-append", item: echo1 });
    let users = userItems(s);
    expect(users).toHaveLength(2);
    expect(users[0]!.id).toBe("srv-1");
    expect(users[0]!.pending).toBeUndefined();
    expect(users[1]!.id).toBe(b.id);
    expect(users[1]!.pending).toBe("sending");

    // Second echo reconciles the remaining ("second") placeholder.
    const echo2 = serverUser("srv-2", "second (rewritten)");
    s = chatReducer(s, { type: "item-append", item: echo2 });
    users = userItems(s);
    expect(users).toHaveLength(2);
    expect(users.map((u) => u.id)).toEqual(["srv-1", "srv-2"]);
    expect(users.every((u) => u.pending === undefined)).toBe(true);
  });
});

describe("F2 (d) — snapshot / reset clear optimistic items", () => {
  test("snapshot rebuilds wholesale from the authoritative server items", () => {
    const opt = optimistic(0, "pending send");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const serverItem = serverUser("srv-1", "real turn");
    const snapshot: ChatSnapshot = {
      items: [serverItem as ChatItem],
      turnState: "idle",
    };
    const frame = {
      kind: "snapshot",
      "chat-id": "c1",
      body: snapshot,
    } as ServerFrame & { kind: "snapshot" };
    const s2 = chatReducer(s1, { type: "snapshot", payload: frame });
    const users = userItems(s2);
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe("srv-1");
    expect(s2.itemsById[opt.id]).toBeUndefined();
  });

  test("reset clears every optimistic item back to EMPTY_STATE", () => {
    const opt = optimistic(0, "pending send");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const s2 = chatReducer(s1, { type: "reset" });
    expect(s2.items).toHaveLength(0);
    expect(s2).toEqual(EMPTY_STATE);
  });
});

describe("F2 (e) — turn-state error/interrupted marks pending items failed", () => {
  test("error transition flips a 'sending' bubble to 'failed' (not removed)", () => {
    const opt = optimistic(0, "this turn will error");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const s2 = chatReducer(s1, {
      type: "turn-state",
      state: "error",
      lastError: "boom",
    });
    const users = userItems(s2);
    expect(users).toHaveLength(1);
    expect(users[0]!.pending).toBe("failed");
    expect(s2.error?.message).toBe("boom");
  });

  test("interrupted transition also fails a pending bubble", () => {
    const opt = optimistic(0, "interrupt me");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const s2 = chatReducer(s1, { type: "turn-state", state: "interrupted" });
    expect(userItems(s2)[0]!.pending).toBe("failed");
  });

  test("running transition leaves a pending bubble 'sending' (F1 cold-start synergy)", () => {
    const opt = optimistic(0, "cold start send");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const s2 = chatReducer(s1, { type: "turn-state", state: "running" });
    expect(userItems(s2)[0]!.pending).toBe("sending");
  });

  test("fail-pending action flips sending → failed and is a no-op otherwise", () => {
    const opt = optimistic(0, "pending");
    const s1 = chatReducer(EMPTY_STATE, { type: "optimistic-user", item: opt });
    const s2 = chatReducer(s1, { type: "fail-pending" });
    expect(userItems(s2)[0]!.pending).toBe("failed");
    // Idempotent: nothing left "sending" → same reference back.
    const s3 = chatReducer(s2, { type: "fail-pending" });
    expect(s3).toBe(s2);
  });
});

describe("F2 — static render/dispatch contract", () => {
  test("submitTurn dispatches an optimistic-user item AFTER the ws.OPEN guard", () => {
    const src = readFileSync(webRoot + "src/routes/live-chat.tsx", "utf8");
    // The optimistic dispatch must live in the same callback that sends
    // the user-turn frame, after the early-return OPEN guard.
    const dispatchMatch = /dispatch\(\{\s*type:\s*["']optimistic-user["']/.exec(
      src,
    );
    expect(dispatchMatch, "submitTurn must dispatch an optimistic-user item")
      .not.toBeNull();
    const guardIdx = src.indexOf("ws.readyState !== ws.OPEN) return;");
    expect(guardIdx).toBeGreaterThan(-1);
    // The dispatch lives after the early-return OPEN guard so a dropped
    // send never leaves a ghost bubble.
    expect(dispatchMatch!.index).toBeGreaterThan(guardIdx);
  });

  test("MessagesTimeline renders a 'Sending…' and 'Failed to send' affordance", () => {
    const src = readFileSync(
      webRoot + "src/components/chat/MessagesTimeline.tsx",
      "utf8",
    );
    expect(src).toContain("Sending…");
    expect(src).toContain("Failed to send");
    expect(src).toMatch(/data-testid="user-message-sending"/);
    expect(src).toMatch(/data-testid="user-message-failed"/);
  });
});
