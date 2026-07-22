/**
 * Contract test for the shared ImageLightbox (components/chat/ImageLightbox.tsx)
 * and its useLightbox hook. Follows the project's node-only static-source
 * convention (no JSDOM runtime) — asserts on the source render contract,
 * mirroring `tool-result-media.test.ts`.
 *
 * Verifies the lightbox is source-agnostic (renders from a `src` string,
 * not from `dataB64`), carousels with prev/next + arrow keys, traps focus,
 * dismisses on Escape/backdrop, and falls back on a broken image.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const lightboxPath = webRoot + "src/components/chat/ImageLightbox.tsx";

function src(): string {
  return readFileSync(lightboxPath, "utf8");
}

describe("ImageLightbox — file + API", () => {
  test("exists at the documented path", () => {
    expect(existsSync(lightboxPath)).toBe(true);
  });

  test("exports ImageLightbox and the useLightbox hook", () => {
    expect(src()).toMatch(/export\s+function\s+ImageLightbox\b/);
    expect(src()).toMatch(/export\s+function\s+useLightbox\b/);
  });

  test("is source-agnostic: renders from `src`, never builds a data: URL itself", () => {
    const s = src();
    // Consumes a resolved `.src` rather than mediaType/dataB64.
    expect(s).toMatch(/\.src\b/);
    expect(s).not.toMatch(/;base64,/);
    expect(s).not.toMatch(/createObjectURL/);
  });
});

describe("ImageLightbox — carousel navigation", () => {
  test("tracks an active index and wraps prev/next via modulo", () => {
    const s = src();
    expect(s).toMatch(/activeIndex/);
    expect(s).toMatch(/%\s*images\.length/);
  });

  test("Left / Right arrow keys cycle the gallery", () => {
    const s = src();
    expect(s).toMatch(/ArrowRight/);
    expect(s).toMatch(/ArrowLeft/);
  });

  test("renders prev / next buttons in multi-image mode", () => {
    const s = src();
    expect(s).toMatch(/Previous image/);
    expect(s).toMatch(/Next image/);
  });
});

describe("ImageLightbox — dismiss + focus trap", () => {
  test("Escape key dismisses", () => {
    expect(src()).toMatch(/Escape/);
  });

  test("backdrop click dismisses (overlay onClick with target guard)", () => {
    const s = src();
    expect(s).toMatch(/onClose/);
    expect(s).toMatch(/e\.target\s*===\s*e\.currentTarget/);
  });

  test("focus-trap: saves/restores focus + constrains Tab", () => {
    const s = src();
    expect(/\.focus\(\)/.test(s) || /activeElement/.test(s)).toBe(true);
    expect(s).toMatch(/Tab/);
  });

  test("renders through a portal to document.body", () => {
    expect(src()).toMatch(/createPortal/);
  });
});

describe("ImageLightbox — broken-image fallback", () => {
  test("wires onError on the main image", () => {
    expect(src()).toMatch(/onError/);
  });
});
