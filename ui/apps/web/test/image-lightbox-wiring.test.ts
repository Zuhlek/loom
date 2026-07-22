/**
 * Contract test for the click-to-open wiring of the shared image lightbox:
 * a click on a thumbnail — in the chat bubble OR the QuestionNav — opens
 * one chat-wide carousel over every user image, owned by live-chat.
 *
 * Node-only static-source convention (no JSDOM), mirroring the sibling
 * image tests.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(webRoot + p, "utf8");

describe("QuestionNav — clickable thumbnails", () => {
  const s = read("src/components/chat/QuestionNav.tsx");
  test("accepts an onOpenImage callback prop", () => {
    expect(s).toMatch(/onOpenImage/);
  });
  test("renders thumbnails via the shared ImageThumb and opens on click", () => {
    expect(s).toMatch(/<ImageThumb\b/);
    expect(s).toMatch(/onOpenImage\(q\.id,\s*i\)/);
  });
});

describe("MessagesTimeline — clickable bubble images", () => {
  const s = read("src/components/chat/MessagesTimeline.tsx");
  test("threads onOpenImage into UserRow", () => {
    expect(s).toMatch(/onOpenImage/);
    expect(s).toMatch(/<UserRow[\s\S]{0,80}onOpenImage/);
  });
  test("bubble thumbnails open the lightbox at (item.id, idx)", () => {
    expect(s).toMatch(/onOpenImage\(item\.id,\s*idx\)/);
  });
});

describe("live-chat — owns the single chat-wide lightbox", () => {
  const s = read("src/routes/live-chat.tsx");
  test("builds the chat-wide image list via collectUserImages", () => {
    expect(s).toMatch(/collectUserImages\(/);
  });
  test("maps a click to the global carousel index before opening", () => {
    expect(s).toMatch(/imageIndexOf\(/);
  });
  test("renders one shared ImageLightbox for both bubble and nav", () => {
    expect(s).toMatch(/<ImageLightbox\b/);
    expect(s).toMatch(/images=\{chatImages\}/);
  });
});
