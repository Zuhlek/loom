/**
 * Sidebar chat-row label resolution (US-004).
 *
 * The inline-rename UX and the right-click context menu were removed —
 * renaming now lives in the per-chat settings modal (the gear icon).
 * What remains, and is asserted here, is how a chat row LABELS itself:
 * `chat.custom_name ?? chat.auto_title ?? cwd-basename`.
 *
 * Static-source scan style (Vitest include = *.test.ts, environment =
 * node, no jsdom) — we read the component source and assert the label
 * chain via string-grep.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const sidebarPath = webRoot + "src/components/LiveSidebar.tsx";

function readSidebar(): string {
  expect(existsSync(sidebarPath)).toBe(true);
  return readFileSync(sidebarPath, "utf8");
}

/** Locate the body of the first `function ChatLink(...)` declaration.
 *
 * The function takes a destructured props arg + a destructured props type
 * (`function ChatLink({ a, b }: { a: T; b: T }) { ... }`), so naïve brace
 * matching from the first `{` would close on the destructured args block.
 * Skip the first two top-level brace pairs (params + type annotation),
 * then brace-match the function body. */
function chatLinkBody(src: string): string {
  const idx = src.indexOf("function ChatLink");
  expect(idx).toBeGreaterThan(-1);
  let cursor = idx;
  for (let skip = 0; skip < 2; skip++) {
    const open = src.indexOf("{", cursor);
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
    cursor = close + 1;
  }
  const bodyOpen = src.indexOf("{", cursor);
  let depth = 0;
  let bodyClose = -1;
  for (let i = bodyOpen; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        bodyClose = i;
        break;
      }
    }
  }
  expect(bodyClose).toBeGreaterThan(bodyOpen);
  return src.slice(bodyOpen, bodyClose + 1);
}

describe("ChatLink label resolution (US-004)", () => {
  test("acc 1a: ChatLink computes label as custom_name ?? auto_title ?? cwd-basename", () => {
    const body = chatLinkBody(readSidebar());
    const hasCustomName = /chat\.custom_name/.test(body);
    const hasAutoTitle = /chat\.auto_title/.test(body);
    const hasCwdBasename =
      /chat\.cwd\.split\(["']\/["']\)/.test(body) ||
      /cwd-basename/.test(body) ||
      /cwdBasename/.test(body);
    expect(hasCustomName).toBe(true);
    expect(hasAutoTitle).toBe(true);
    expect(hasCwdBasename).toBe(true);
    // Must use ?? operator (not ||) to preserve empty-string semantics.
    expect(
      /chat\.custom_name\s*\?\?\s*chat\.auto_title\s*\?\?/.test(body),
    ).toBe(true);
  });

  test("acc 1b: chain order is custom_name → auto_title → cwd-basename", () => {
    const body = chatLinkBody(readSidebar());
    const chain = body.match(
      /chat\.custom_name\s*\?\?\s*chat\.auto_title\s*\?\?\s*([A-Za-z_][\w.]*|chat\.cwd[^\n;]*)/,
    );
    expect(chain).not.toBeNull();
  });

  test("acc 2: unassigned chats render through the same ChatLink (no project_id branching)", () => {
    const src = readSidebar();
    const unassignedSection = src.slice(src.indexOf("unassigned.map"));
    expect(/<ChatLink\b/.test(unassignedSection)).toBe(true);
    const body = chatLinkBody(src);
    const labelBlock = body.slice(0, body.indexOf("return"));
    expect(/chat\.project_id/.test(labelBlock)).toBe(false);
  });

  test("acc 3: tooltip preserves the cwd path on every row", () => {
    const body = chatLinkBody(readSidebar());
    expect(/title=\{`\$\{chat\.cwd\}/.test(body)).toBe(true);
  });
});

describe("sidebar — right-click context menu removed", () => {
  test("LiveSidebar no longer imports or renders ChatContextMenu", () => {
    const src = readSidebar();
    expect(src).not.toMatch(/ChatContextMenu/);
    expect(src).not.toMatch(/onContextMenu/);
  });

  test("the ChatContextMenu component file is gone", () => {
    expect(existsSync(webRoot + "src/components/sidebar/ChatContextMenu.tsx")).toBe(false);
  });
});
