/**
 * Unit tests for lib/chat-images.ts — the single source of truth for
 * resolving a UserMessageImage to an <img> src and for flattening every
 * user image in a chat into the shared lightbox carousel list.
 *
 * Runtime unit test (imports the real module + executes it), matching the
 * precedent set by `board-parser.test.ts` / `fabric-phase-map.test.ts`.
 */
import { describe, expect, test } from "vitest";

import { imageSrc, collectUserImages } from "../src/lib/chat-images";
import type { TimelineRow } from "../src/lib/timeline-rows";
import type { UserMessageImage } from "../src/lib/chat-types";

function userRow(id: string, images: UserMessageImage[]): TimelineRow {
  return {
    kind: "user",
    id,
    item: {
      kind: "user-message",
      id,
      turnId: id,
      text: "q",
      createdAt: "2026-01-01T00:00:00.000Z",
      images,
    },
  };
}

function systemRow(id: string): TimelineRow {
  return {
    kind: "system",
    id,
    item: { kind: "system-notice", id, text: "sys", level: "info", createdAt: "" },
  };
}

describe("imageSrc", () => {
  test("inline dataB64 wins → data: URL", () => {
    expect(imageSrc({ mediaType: "image/png", dataB64: "AAAA" }, "c1")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("dataB64 takes precedence over id", () => {
    expect(imageSrc({ mediaType: "image/png", dataB64: "AAAA", id: "abc" }, "c1")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("id only → /api/chat-image read-back URL with encoded params", () => {
    expect(imageSrc({ mediaType: "image/png", id: "de/ad" }, "c/1")).toBe(
      "/api/chat-image?chatId=c%2F1&id=de%2Fad",
    );
  });

  test("neither dataB64 nor id → undefined (no broken <img>)", () => {
    expect(imageSrc({ mediaType: "image/png" }, "c1")).toBeUndefined();
  });
});

describe("collectUserImages", () => {
  test("flattens user images in timeline then per-message order", () => {
    const rows = [
      userRow("m1", [
        { mediaType: "image/png", dataB64: "A" },
        { mediaType: "image/png", id: "id2" },
      ]),
      systemRow("s1"),
      userRow("m2", [{ mediaType: "image/png", dataB64: "B" }]),
    ];
    const { images } = collectUserImages(rows, "c1");
    expect(images.map((i) => i.src)).toEqual([
      "data:image/png;base64,A",
      "/api/chat-image?chatId=c1&id=id2",
      "data:image/png;base64,B",
    ]);
  });

  test("skips unresolved images and counts localIdx over resolvable only", () => {
    const rows = [
      userRow("m1", [
        { mediaType: "image/png" }, // unresolved → skipped
        { mediaType: "image/png", dataB64: "A" }, // local 0
        { mediaType: "image/png", dataB64: "B" }, // local 1
      ]),
    ];
    const { images, indexOf } = collectUserImages(rows, "c1");
    expect(images).toHaveLength(2);
    expect(indexOf("m1", 0)).toBe(0);
    expect(indexOf("m1", 1)).toBe(1);
  });

  test("indexOf maps (messageId, localIdx) to global carousel index", () => {
    const rows = [
      userRow("m1", [{ mediaType: "image/png", dataB64: "A" }]),
      userRow("m2", [
        { mediaType: "image/png", dataB64: "B" },
        { mediaType: "image/png", dataB64: "C" },
      ]),
    ];
    const { indexOf } = collectUserImages(rows, "c1");
    expect(indexOf("m1", 0)).toBe(0);
    expect(indexOf("m2", 0)).toBe(1);
    expect(indexOf("m2", 1)).toBe(2);
  });

  test("indexOf returns -1 for an unknown key", () => {
    const { indexOf } = collectUserImages([userRow("m1", [])], "c1");
    expect(indexOf("nope", 0)).toBe(-1);
    expect(indexOf("m1", 5)).toBe(-1);
  });
});
