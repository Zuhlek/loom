/**
 * T-004 — Materializer resolves @<path> tokens in user turns into
 * UserMessageItem.images and strips them from the displayed text (US-003).
 */
import { describe, expect, it } from "vitest";
import { createMaterializer } from "../src/process-manager/jsonl/materializer.ts";
import type { ClaudeEvent } from "../src/process-manager/jsonl/schema.ts";
import type { StagedImageMeta } from "../src/process-manager/jsonl/image-store.ts";
import type { UserMessageItem } from "../src/chat-protocol/messages.ts";

function userEv(id: string, text: string): ClaudeEvent {
  return {
    schemaVersion: "v1",
    chatId: "c-1",
    sessionId: "s-1",
    tsIso: "2026-01-01T00:00:00.000Z",
    kind: "text",
    id,
    role: "user",
    text,
  } as unknown as ClaudeEvent;
}

/** Resolver that recognises a single known abs path. */
function resolverFor(
  knownPath: string,
  meta: StagedImageMeta,
): (absPath: string) => StagedImageMeta | undefined {
  return (absPath) => (absPath === knownPath ? meta : undefined);
}

const META: StagedImageMeta = {
  mediaType: "image/png",
  filename: "shot.png",
  stagedAt: "2026-01-01T00:00:00.000Z",
  id: "a".repeat(32),
};

function userItems(snapshot: { items: { kind: string }[] }): UserMessageItem[] {
  return snapshot.items.filter((i) => i.kind === "user-message") as UserMessageItem[];
}

describe("materializer — @<path> image fold (T-004)", () => {
  it("resolves a recognised token into a UserMessageImage (no dataB64) and strips it from text", () => {
    const m = createMaterializer({
      chatId: "c-1",
      resolveImage: resolverFor("/abs/shot.png", META),
    });
    m.ingest(userEv("e1", "look @/abs/shot.png"));
    const [item] = userItems(m.snapshot());
    expect(item.text).toBe("look");
    expect(item.images).toHaveLength(1);
    expect(item.images![0]).toMatchObject({
      mediaType: "image/png",
      filename: "shot.png",
      id: "a".repeat(32),
    });
    expect(item.images![0]).not.toHaveProperty("dataB64");
  });

  it("leaves an unrecognised literal @token untouched and adds no image", () => {
    const m = createMaterializer({
      chatId: "c-1",
      resolveImage: resolverFor("/abs/shot.png", META),
    });
    m.ingest(userEv("e1", "email me @someone please"));
    const [item] = userItems(m.snapshot());
    expect(item.text).toBe("email me @someone please");
    expect(item.images ?? []).toHaveLength(0);
  });

  it("re-folding the same event id is idempotent: images are not duplicated", () => {
    const m = createMaterializer({
      chatId: "c-1",
      resolveImage: resolverFor("/abs/shot.png", META),
    });
    const e = userEv("e1", "hi @/abs/shot.png");
    m.ingest(e);
    m.ingest(e);
    const items = userItems(m.snapshot());
    expect(items).toHaveLength(1);
    expect(items[0].images).toHaveLength(1);
  });

  it("when the resolver returns undefined, the image is omitted but the text still renders", () => {
    const m = createMaterializer({
      chatId: "c-1",
      resolveImage: () => undefined,
    });
    m.ingest(userEv("e1", "hi @/abs/unknown.png"));
    const [item] = userItems(m.snapshot());
    // The unrecognised token is left in place (tolerant matcher).
    expect(item.text).toBe("hi @/abs/unknown.png");
    expect(item.images ?? []).toHaveLength(0);
  });

  it("with no resolver injected, behaves exactly as before (text passthrough, no images)", () => {
    const m = createMaterializer({ chatId: "c-1" });
    m.ingest(userEv("e1", "plain @/abs/shot.png"));
    const [item] = userItems(m.snapshot());
    expect(item.text).toBe("plain @/abs/shot.png");
    expect(item.images ?? []).toHaveLength(0);
  });
});
