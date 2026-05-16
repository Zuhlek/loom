/**
 * T-009 — LiveSidebar wires the ChatContextMenu + detached visual (US-003).
 *
 * Static-source scan style (Vitest harness — *.test.ts, environment =
 * node, no jsdom). We assert the LiveSidebar source has:
 *   - imports ChatContextMenu from components/sidebar/ChatContextMenu;
 *   - imports handoffChat + forkChat from lib/api;
 *   - wires onContextMenu={...} on chat rows (preventDefault + capture
 *     clientX/clientY);
 *   - renders <ChatContextMenu /> when state is non-null;
 *   - detached-row visual treatment uses the ↗ glyph.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const sidebarPath = webRoot + "src/components/LiveSidebar.tsx";

function readSrc(): string {
  return readFileSync(sidebarPath, "utf8");
}

describe("T-009 LiveSidebar wiring", () => {
  test("imports ChatContextMenu from components/sidebar/ChatContextMenu", () => {
    const src = readSrc();
    expect(
      /import\s+\{\s*ChatContextMenu\s*\}\s+from\s+["']\.\/sidebar\/ChatContextMenu["']/.test(src),
    ).toBe(true);
  });

  test("imports handoffChat and forkChat from lib/api", () => {
    const src = readSrc();
    expect(/\bhandoffChat\b/.test(src)).toBe(true);
    expect(/\bforkChat\b/.test(src)).toBe(true);
  });

  test("wires onContextMenu on the chat-row container with preventDefault + clientX/clientY", () => {
    const src = readSrc();
    expect(/onContextMenu=\{/.test(src)).toBe(true);
    expect(/preventDefault\(\)/.test(src)).toBe(true);
    expect(/clientX/.test(src)).toBe(true);
    expect(/clientY/.test(src)).toBe(true);
  });

  test("renders <ChatContextMenu ...> when the menu state is non-null", () => {
    const src = readSrc();
    // The component is mounted inside a conditional. Allow the JSX
    // pattern to span multiple lines.
    expect(/<ChatContextMenu\b/.test(src)).toBe(true);
    const gated =
      /(menu(?:State)?|contextMenu)\s*\?\s*\(?\s*\n?\s*<ChatContextMenu/s.test(src) ||
      /(menu(?:State)?|contextMenu)\s*&&\s*\(?\s*\n?\s*<ChatContextMenu/s.test(src);
    expect(gated).toBe(true);
  });

  test("Handoff handler calls handoffChat(chat.id)", () => {
    const src = readSrc();
    expect(/handoffChat\(\s*chat(?:\.\s*id|\s*\.id)?/.test(src)).toBe(true);
  });

  test("Fork handler calls forkChat(chat.id)", () => {
    const src = readSrc();
    expect(/forkChat\(\s*chat(?:\.\s*id|\s*\.id)?/.test(src)).toBe(true);
  });

  test("detached visual uses the ↗ glyph", () => {
    const src = readSrc();
    expect(src.includes("↗")).toBe(true);
  });
});
