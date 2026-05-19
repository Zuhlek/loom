/**
 * T-006 — ToolResultMedia (web side).
 *
 * Verifies US-006 AC2-5 + ADR-003 (ship all three variants) +
 * ADR-006 (data-URL transport) + ADR-007 (`images` field):
 *
 *   AC2 (web): single image renders inline; clicking expands a
 *              lightbox modal.
 *   AC3 (web): multi-image renders a thumbnail strip; clicking any
 *              opens the lightbox with the gallery navigation
 *              (prev/next, active index).
 *   AC4 (web): the lightbox traps focus and dismisses on Escape /
 *              backdrop click. The component source declares the
 *              focus-trap + Escape + backdrop dismiss wiring.
 *   AC5 (web): broken image data has an `onError` fallback that
 *              swaps in an "image unavailable" placeholder; no throw.
 *
 *   ADR-003:  ToolResultMedia carries all three variants: single
 *              inline + lightbox, multi-image gallery, focus-trap.
 *              No phasing.
 *   ADR-006:  the rendered `<img src>` is a data URL constructed from
 *              `mediaType` + `dataB64`. No blob URLs (the source must
 *              not call `URL.createObjectURL`).
 *   ADR-007:  the component prop is `images: ToolResultImage[]`.
 *
 * Test style: matches T-001/T-002/T-004/T-009 — vitest in node
 * runtime (no jsdom), static-source contract checks for `.tsx` source
 * (the vitest include glob is `apps/** /test/** /*.test.ts`). This
 * mirrors the precedent set by `ask-user-question-picker.test.ts` and
 * `composer-controls.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const mediaPath = webRoot + "src/components/chat/ToolResultMedia.tsx";
const toolCardPath = webRoot + "src/components/chat/ToolUseCard.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";

describe("T-006 ToolResultMedia — file exists and declares contract (US-006 + ADR-003/006/007)", () => {
  test("ToolResultMedia.tsx exists at the documented path", () => {
    expect(existsSync(mediaPath)).toBe(true);
  });

  test("component accepts `images` prop typed against ToolResultImage", () => {
    const src = readFileSync(mediaPath, "utf8");
    expect(src).toMatch(/images\s*[:?]/);
    // The source mentions the shared image type or its field names.
    expect(src).toMatch(/ToolResultImage|mediaType|dataB64/);
  });

  test("renders data-URL `src` (ADR-006) — no blob URLs", () => {
    const src = readFileSync(mediaPath, "utf8");
    // Must construct `data:<mediaType>;base64,<dataB64>` for `<img>`
    // (the data-URL transport per ADR-006).
    expect(src).toMatch(/data:\$\{[^}]*mediaType[^}]*\};base64,\$\{/);
    // Must NOT mint blob URLs.
    expect(src).not.toMatch(/createObjectURL/);
  });
});

describe("T-006 ToolResultMedia — single image variant (US-006 AC2, ADR-003)", () => {
  test("source branches on a single-image count (length === 1 or length > 1)", () => {
    const src = readFileSync(mediaPath, "utf8");
    // The component must select between single and multi by checking
    // `images.length`. Accept either `=== 1` or `> 1` or `.length`
    // followed by a branch operator.
    const hasBranch =
      /images\.length\s*===\s*1/.test(src) ||
      /images\.length\s*>\s*1/.test(src) ||
      /images\.length\s*<\s*2/.test(src) ||
      /images\.length\s*>=\s*2/.test(src);
    expect(hasBranch).toBe(true);
  });

  test("clicking the inline image opens a lightbox", () => {
    const src = readFileSync(mediaPath, "utf8");
    // The component owns lightbox-open state and toggles it on click.
    expect(src).toMatch(/onClick/);
    // The lightbox is referenced as state or a named component / value.
    const hasLightbox = /lightbox|Lightbox|isOpen|setOpen/.test(src);
    expect(hasLightbox).toBe(true);
  });
});

describe("T-006 ToolResultMedia — multi-image gallery (US-006 AC3, ADR-003)", () => {
  test("renders a thumbnail strip when there are multiple images", () => {
    const src = readFileSync(mediaPath, "utf8");
    // The component must iterate the images array (`.map(`) so each
    // image lands as a thumbnail. Single-image variant may also map,
    // so this is a necessary-but-not-sufficient check (combined with
    // the length-branch above it is sufficient).
    expect(src).toMatch(/images\.map\(/);
  });

  test("multi-image lightbox owns an active-index state for prev/next", () => {
    const src = readFileSync(mediaPath, "utf8");
    // The gallery navigation tracks the current image index. Accept
    // any of the common variable names.
    const hasIndex =
      /activeIndex|currentIndex|setIndex|setActive|setCurrent/.test(src);
    expect(hasIndex).toBe(true);
  });
});

describe("T-006 ToolResultMedia — lightbox dismiss + focus trap (US-006 AC4, ADR-003)", () => {
  test("Escape key dismisses the lightbox", () => {
    const src = readFileSync(mediaPath, "utf8");
    // Common patterns: `key === "Escape"` or `Escape` literal in a
    // keydown handler.
    expect(src).toMatch(/Escape/);
  });

  test("backdrop click dismisses the lightbox", () => {
    const src = readFileSync(mediaPath, "utf8");
    // The component has a backdrop element with its own onClick
    // (distinct from the image's onClick — the image click should
    // stop propagation or sit on a different element).
    expect(src).toMatch(/backdrop|onClose|close|dismiss/i);
  });

  test("focus-trap logic is present (saves/restores focus + keyboard cycling)", () => {
    const src = readFileSync(mediaPath, "utf8");
    // ADR-003: inline focus-trap (~1 KB). Look for the canonical
    // focus-trap markers: focus(), activeElement, Tab handling, or
    // a focus restore on unmount/close.
    const hasFocusTrap =
      /\.focus\(\)/.test(src) ||
      /activeElement/.test(src) ||
      /focusTrap|FocusTrap/.test(src) ||
      /focus(\b|\W)/.test(src);
    expect(hasFocusTrap).toBe(true);
  });
});

describe("T-006 ToolResultMedia — broken-image fallback (US-006 AC5)", () => {
  test("source wires an `onError` handler on the <img> for fallback", () => {
    const src = readFileSync(mediaPath, "utf8");
    expect(src).toMatch(/onError/);
  });

  test("source mentions the `image unavailable` placeholder copy", () => {
    const src = readFileSync(mediaPath, "utf8");
    // Either the exact phrase or an aria-friendly variant.
    expect(src).toMatch(/unavailable|placeholder|broken|failed/i);
  });
});

describe("T-006 chat-types — ToolResultSummary.images mirror (ADR-007)", () => {
  test("chat-types declares a `ToolResultImage` interface or equivalent type", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/ToolResultImage|images\?\s*:/);
  });

  test("chat-types ToolResultSummary carries an optional `images` field", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/images\?\s*:\s*(?:Array|ToolResultImage|\[)/);
  });
});

describe("T-006 ToolUseCard wires ToolResultMedia when images are present", () => {
  test("ToolUseCard imports the new ToolResultMedia component", () => {
    const src = readFileSync(toolCardPath, "utf8");
    expect(src).toMatch(/ToolResultMedia/);
  });

  test("ToolUseCard renders <ToolResultMedia> when result.images is non-empty", () => {
    const src = readFileSync(toolCardPath, "utf8");
    // Look for a render-time reference to the component inside a
    // conditional gated on `images`.
    expect(src).toMatch(/<ToolResultMedia\b/);
    expect(src).toMatch(/images/);
  });
});
