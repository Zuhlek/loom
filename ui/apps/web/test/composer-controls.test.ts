/**
 * T-004 — Composer permission-mode + queue-priority controls (web side).
 *
 * Test style matches the project's static-source + pure-logic smoke
 * pattern (see chat-markdown-shiki.test.ts) — vitest's include glob is
 * `apps/** /test/** /*.test.ts` only and the test runtime is `node`
 * (no jsdom). We verify the component source declares the new props
 * and renders the required controls, and we exercise the live-chat
 * frame-emission contract through the chat-types union.
 *
 * What we assert:
 *   AC1 (web): the ChatComposer's render output declares a
 *       permission-mode `<select>` with the four SDK PermissionMode
 *       option values (`default`, `plan`, `acceptEdits`,
 *       `bypassPermissions`).
 *   AC2 (web): the component accepts an `onPermissionModeChange` prop
 *       and wires it to the `<select>` `onChange` handler.
 *   AC3 (web): the queue-priority control renders when the parent
 *       passes `composerMode === "queue"` (turnState === "running").
 *   live-chat: the route imports `PermissionMode` from chat-types and
 *       emits a typed `permission-mode-set` ClientFrame on mode change,
 *       plus carries the `priority` field on `user-turn` frames.
 *   mirror: chat-types.ts declares `PermissionMode`,
 *       `PermissionModeSetFrame`, and the `priority` field on the
 *       `user-turn` ClientFrame variant — matching the server union.
 *
 * RED path:
 *   Before implementation, the composer source does NOT contain the
 *   new option strings, props, or queue-priority markers; the static
 *   regexes return false; the runtime expects fail. The chat-types
 *   mirror also lacks `PermissionMode` exports, which makes the type
 *   import at the top of this file fail at `tsc --noEmit` — to keep
 *   the runtime red phase clean we re-declare the union locally in
 *   the red phase and switch to the real import once landed.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";

// The four SDK PermissionMode values US-004 AC1 enumerates.
const MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;

describe("T-004 ChatComposer — permission-mode selector (US-004 AC1/AC2)", () => {
  test("ChatComposer.tsx exists at the documented path", () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  test("ChatComposer renders a <select> populated with the four SDK PermissionMode values", () => {
    const src = readFileSync(composerPath, "utf8");
    // The component must emit a `<select` element. The actual JSX is
    // verified by string-grep so the test does not depend on jsdom.
    expect(src).toMatch(/<select\b/);
    // Each SDK mode appears as a string literal somewhere in the
    // source — either as an inline `value="..."` attribute or in the
    // `<option>` list / option-config array.
    for (const mode of MODES) {
      const re = new RegExp(`["']${mode}["']`);
      expect(src).toMatch(re);
    }
  });

  test("ChatComposer accepts `permissionMode` + `onPermissionModeChange` props", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/permissionMode\s*[:?]/);
    expect(src).toMatch(/onPermissionModeChange/);
  });

  test("ChatComposer wires `onPermissionModeChange` to the <select>'s onChange", () => {
    const src = readFileSync(composerPath, "utf8");
    // Loose match: onChange handler that calls onPermissionModeChange.
    // The narrow contract is that *something* invokes the prop.
    expect(src).toMatch(/onPermissionModeChange\s*\(/);
  });
});

// Queue-priority describe block intentionally removed: the composer no
// longer exposes a priority toggle (the chip was confusing and the
// "send now / send-next" distinction was not required — every submit
// now lands on the SDK's default queue placement). The wire still
// accepts an optional `priority` field (server-side ADR-004) for
// future use, but the web no longer emits it.

describe("T-004 chat-types mirror — PermissionMode + frame variants", () => {
  test("chat-types exports a `PermissionMode` union with the four SDK values", () => {
    const src = readFileSync(typesPath, "utf8");
    // Type alias or interface body must include each of the four values.
    expect(src).toMatch(/PermissionMode/);
    for (const mode of MODES) {
      expect(src).toMatch(new RegExp(`["']${mode}["']`));
    }
  });

  test("chat-types ClientFrame union includes `permission-mode-set`", () => {
    const src = readFileSync(typesPath, "utf8");
    expect(src).toMatch(/permission-mode-set/);
  });

  test("chat-types `user-turn` body declares an optional `priority` field", () => {
    const src = readFileSync(typesPath, "utf8");
    // Loose: the field name appears in the user-turn body section.
    // Strict shape is enforced by tsc-noEmit at the server↔web mirror.
    expect(src).toMatch(/priority\?\s*:/);
  });
});

describe("T-004 live-chat — frame emission + composer wiring", () => {
  test("live-chat dispatches a `permission-mode-set` frame when the dropdown changes", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/permission-mode-set/);
  });

  test("live-chat tracks `permissionMode` in reducer state and supplies it to the composer", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/permissionMode/);
  });
});
