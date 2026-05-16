/**
 * T-006 — components/sidebar/ChatContextMenu.tsx (US-003).
 *
 * Static-source scan style (matches the project's existing test
 * harness — Vitest include = *.test.ts, environment = node, no jsdom).
 * We assert the contract by reading the component source: it exports
 * the right symbol, accepts the typed props from design Interfaces,
 * renders Handoff + Fork entries, wires outside-click + Escape to
 * onClose, and positions itself at props.position.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const componentPath = webRoot + "src/components/sidebar/ChatContextMenu.tsx";

function readSrc(): string {
  expect(existsSync(componentPath)).toBe(true);
  return readFileSync(componentPath, "utf8");
}

describe("T-006 ChatContextMenu component contract (US-003 AC1 partial)", () => {
  test("file exists at components/sidebar/ChatContextMenu.tsx", () => {
    expect(existsSync(componentPath)).toBe(true);
  });

  test("exports a named ChatContextMenu function/component", () => {
    const src = readSrc();
    expect(/export\s+function\s+ChatContextMenu\b/.test(src)).toBe(true);
  });

  test("exports the ChatContextMenuProps interface (design Interfaces)", () => {
    const src = readSrc();
    expect(/export\s+interface\s+ChatContextMenuProps\b/.test(src)).toBe(true);
  });

  test("props include chat, position, onClose, onHandoff, onFork", () => {
    const src = readSrc();
    // Pull the props interface body via brace-matching to handle the
    // nested `{ x: number; y: number }` shape of `position`.
    const idx = src.indexOf("interface ChatContextMenuProps");
    expect(idx).toBeGreaterThan(-1);
    const open = src.indexOf("{", idx);
    let depth = 0;
    let close = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(open);
    const body = src.slice(open, close);
    expect(/\bchat\s*:/.test(body)).toBe(true);
    expect(/\bposition\s*:/.test(body)).toBe(true);
    expect(/\bonClose\s*\(/.test(body) || /\bonClose\s*:/.test(body)).toBe(true);
    expect(/\bonHandoff\s*\(/.test(body) || /\bonHandoff\s*:/.test(body)).toBe(true);
    expect(/\bonFork\s*\(/.test(body) || /\bonFork\s*:/.test(body)).toBe(true);
  });
});

describe("T-006 ChatContextMenu DOM and behaviour", () => {
  test("renders both Handoff and Fork entries (visible labels)", () => {
    const src = readSrc();
    expect(/Handoff/i.test(src)).toBe(true);
    expect(/Fork/i.test(src)).toBe(true);
  });

  test("Handoff button invokes onHandoff with the chat", () => {
    const src = readSrc();
    // Either onClick={() => props.onHandoff(...)} or onClick={() => onHandoff(...)}
    expect(/onHandoff\s*\(/.test(src)).toBe(true);
  });

  test("Fork button invokes onFork with the chat", () => {
    const src = readSrc();
    expect(/onFork\s*\(/.test(src)).toBe(true);
  });

  test("menu position uses props.position.x / props.position.y", () => {
    const src = readSrc();
    // Accept either position.x or destructured x reads next to a top/left style.
    const usesX = /position\.x\b/.test(src) || /\bleft:\s*\{?\s*x\b/.test(src);
    const usesY = /position\.y\b/.test(src) || /\btop:\s*\{?\s*y\b/.test(src);
    expect(usesX).toBe(true);
    expect(usesY).toBe(true);
  });

  test("Escape key closes the menu (onClose)", () => {
    const src = readSrc();
    // Wire Escape via window keydown listener or the menu's onKeyDown.
    expect(/Escape/.test(src)).toBe(true);
    expect(/onClose\s*\(/.test(src)).toBe(true);
  });

  test("outside-click closes the menu (mousedown/click listener on document or window)", () => {
    const src = readSrc();
    // Wire outside-click via window/document listener.
    const hasOutsideListener =
      /document\.addEventListener\(\s*["'](?:mousedown|click|pointerdown)["']/.test(src) ||
      /window\.addEventListener\(\s*["'](?:mousedown|click|pointerdown)["']/.test(src);
    expect(hasOutsideListener).toBe(true);
  });

  test("does not import the deleted /handoff mockup route", () => {
    const src = readSrc();
    expect(src).not.toMatch(/handoff-fork-menu/);
  });
});
