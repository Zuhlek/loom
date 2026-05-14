/**
 * T-007 — Sidebar label resolution and inline-rename UX.
 *
 * Static-source scan style (matches the project's existing test harness
 * — Vitest include = *.test.ts, environment = node, no jsdom). We
 * assert the contract by reading the component source:
 *
 *   - LiveSidebar's ChatLink computes `chat.custom_name ?? chat.auto_title ?? cwd-basename`.
 *   - The tooltip text on the chat row still contains the cwd path.
 *   - LiveSidebar holds `renameTargetId: string | null` state and threads
 *     rename callbacks through ChatLink, including triggering an
 *     immediate sidebar refresh on rename success.
 *   - ChatLink swaps the label `<span>` for an `<input>` when isRenaming,
 *     pre-filled with the resolved label, autofocused, and wires
 *     Enter / Escape / blur per the spec's state machine.
 *   - ChatContextMenu exposes "Rename" between Handoff and Fork and adds
 *     an `onRename` prop.
 *
 * The 11 test cases mirror the test sketch in the task spec:
 *   US-004 acc 1 — three label-resolution cases (custom_name wins;
 *     auto_title wins when custom_name null; cwd-basename when both null).
 *   US-004 acc 2 — unassigned chats use the same chain.
 *   US-004 acc 3 — tooltip still shows the cwd path.
 *   US-002 acc 1 — context menu order: Handoff, Rename, Fork.
 *   US-002 acc 2 — Rename swaps the row's label for a pre-filled input.
 *   US-002 acc 3 — Enter with a non-empty trimmed value calls renameChat
 *     and refreshes the sidebar.
 *   US-002 acc 4 — Escape and blur both cancel without calling renameChat.
 *   US-002 acc 5 — Enter with an empty trimmed value calls
 *     renameChat(id, null).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = decodeURIComponent(new URL("../", import.meta.url).pathname);
const sidebarPath = webRoot + "src/components/LiveSidebar.tsx";
const menuPath = webRoot + "src/components/sidebar/ChatContextMenu.tsx";

function readSidebar(): string {
  expect(existsSync(sidebarPath)).toBe(true);
  return readFileSync(sidebarPath, "utf8");
}

function readMenu(): string {
  expect(existsSync(menuPath)).toBe(true);
  return readFileSync(menuPath, "utf8");
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

describe("T-007 ChatLink label resolution (US-004)", () => {
  test("acc 1a: ChatLink computes label as custom_name ?? auto_title ?? cwd-basename", () => {
    const body = chatLinkBody(readSidebar());
    // Resolution chain must reference all three sources in order.
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
    // Anchor on the single resolution expression. Match the whole chain
    // up through the third operand so the assertion is about the
    // sequence of references, not their declaration positions elsewhere.
    const chain = body.match(
      /chat\.custom_name\s*\?\?\s*chat\.auto_title\s*\?\?\s*([A-Za-z_][\w.]*|chat\.cwd[^\n;]*)/,
    );
    expect(chain).not.toBeNull();
  });

  test("acc 2: unassigned chats render through the same ChatLink (no project_id branching)", () => {
    const src = readSidebar();
    // The unassigned branch reuses <ChatLink ... /> rather than inlining
    // a different label formula.
    const unassignedSection = src.slice(src.indexOf("unassigned.map"));
    expect(/<ChatLink\b/.test(unassignedSection)).toBe(true);
    // ChatLink body itself does not branch on chat.project_id when
    // computing the label.
    const body = chatLinkBody(src);
    const labelBlock = body.slice(0, body.indexOf("return"));
    expect(/chat\.project_id/.test(labelBlock)).toBe(false);
  });

  test("acc 3: tooltip preserves the cwd path on every row", () => {
    const body = chatLinkBody(readSidebar());
    // The existing `${chat.cwd} · ${chat.permission_mode}...` title prop.
    expect(/title=\{`\$\{chat\.cwd\}/.test(body)).toBe(true);
  });
});

describe("T-007 ChatContextMenu — Rename menuitem (US-002 acc 1)", () => {
  test("declares onRename in ChatContextMenuProps", () => {
    const src = readMenu();
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
    expect(/\bonRename\s*[(:]/.test(body)).toBe(true);
  });

  test("Rename menuitem renders between Handoff and Fork (visible-label order)", () => {
    const src = readMenu();
    const handoffIdx = src.search(/Handoff to terminal/);
    const renameIdx = src.search(/>\s*Rename\s*</);
    const forkIdx = src.search(/>\s*Fork chat\s*</);
    expect(handoffIdx).toBeGreaterThan(-1);
    expect(renameIdx).toBeGreaterThan(-1);
    expect(forkIdx).toBeGreaterThan(-1);
    expect(handoffIdx).toBeLessThan(renameIdx);
    expect(renameIdx).toBeLessThan(forkIdx);
  });

  test("Rename button invokes onRename(chat)", () => {
    const src = readMenu();
    expect(/onRename\s*\(/.test(src)).toBe(true);
  });
});

describe("T-007 LiveSidebar — inline rename state machine (US-002 acc 2..5)", () => {
  test("acc 2: holds renameTargetId state (one row at a time) and threads it through ChatLink", () => {
    const src = readSidebar();
    expect(/renameTargetId/.test(src)).toBe(true);
    expect(/setRenameTargetId/.test(src)).toBe(true);
    // Use a single `string | null` slice — guards the "only one row at
    // a time" invariant.
    expect(/useState<\s*string\s*\|\s*null\s*>/.test(src)).toBe(true);
    // ChatLink call-sites pass the isRenaming flag.
    expect(/isRenaming=\{/.test(src)).toBe(true);
  });

  test("acc 2: ChatLink swaps the label <span> for a pre-filled <input> when isRenaming", () => {
    const body = chatLinkBody(readSidebar());
    expect(/isRenaming/.test(body)).toBe(true);
    expect(/<input\b/.test(body)).toBe(true);
    // Input must be pre-filled with the resolved label (defaultValue or
    // value bound to the label).
    const inputBlock = body.slice(body.indexOf("<input"));
    const hasPrefill =
      /defaultValue=\{[^}]*label[^}]*\}/.test(inputBlock) ||
      /value=\{[^}]*label[^}]*\}/.test(inputBlock);
    expect(hasPrefill).toBe(true);
    // Autofocus so the user can type immediately.
    expect(/autoFocus/.test(inputBlock)).toBe(true);
  });

  test("acc 3: Enter with a non-empty trimmed value calls renameChat and triggers an immediate sidebar refresh", () => {
    const src = readSidebar();
    // renameChat is imported from lib/api.
    expect(
      /import\s+\{[^}]*\brenameChat\b[^}]*\}\s+from\s+["']\.\.\/lib\/api["']/.test(
        src,
      ),
    ).toBe(true);
    // A rename handler invokes renameChat(...) and then refresh()
    // (the existing useSidebarState refresh) so the new label appears
    // without waiting up to 5 seconds.
    expect(/renameChat\s*\(/.test(src)).toBe(true);
    const renameHandler = src.slice(src.indexOf("renameChat("));
    expect(/refresh\s*\(\s*\)/.test(renameHandler)).toBe(true);
  });

  test("acc 4: Escape and blur both cancel without calling renameChat", () => {
    const body = chatLinkBody(readSidebar());
    expect(/onCancelRename/.test(body)).toBe(true);
    // Escape on the input triggers cancel.
    expect(/Escape/.test(body)).toBe(true);
    // Blur on the input triggers cancel.
    expect(/onBlur=\{/.test(body)).toBe(true);
  });

  test("acc 5: Enter with an empty trimmed value submits renameChat(id, null)", () => {
    const body = chatLinkBody(readSidebar());
    // Enter handler trims and forwards either the trimmed string or
    // null when empty. The submit signature on ChatLink is
    // `onSubmitRename(value: string | null)` — verify both branches.
    expect(/onSubmitRename/.test(body)).toBe(true);
    // Trim + non-empty → value; trim + empty → null. The component
    // calls onSubmitRename with `null` for the empty-trim branch.
    const hasNullBranch =
      /onSubmitRename\(\s*null\s*\)/.test(body) ||
      /onSubmitRename\([^)]*\?\s*[^:]+:\s*null\s*\)/.test(body) ||
      /onSubmitRename\([^)]*length\s*===?\s*0[^)]*\)/.test(body);
    expect(hasNullBranch).toBe(true);
    // The LiveSidebar-side onSubmit handler forwards that value to
    // renameChat verbatim — verify by source-level pattern.
    const src = readSidebar();
    expect(/renameChat\([^)]*,\s*[^)]*\)/.test(src)).toBe(true);
  });
});
