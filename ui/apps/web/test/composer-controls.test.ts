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
const permissionLevelPillPath =
  webRoot + "src/components/chat/PermissionLevelPill.tsx";
const buildPlanTogglePillPath =
  webRoot + "src/components/chat/BuildPlanTogglePill.tsx";

// The four SDK PermissionMode values US-004 AC1 enumerates.
const MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;

describe("T-004 ChatComposer — permission-mode selector (US-004 AC1/AC2)", () => {
  test("ChatComposer.tsx exists at the documented path", () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  test("the four SDK PermissionMode values are surfaced through the permission pills", () => {
    // The permission-mode selector was refactored out of a single
    // <select> in ChatComposer into two pill controls: the non-plan
    // modes live in PermissionLevelPill, and `plan` toggles via
    // BuildPlanTogglePill. ChatComposer renders both pills.
    const composerSrc = readFileSync(composerPath, "utf8");
    expect(composerSrc).toMatch(/<PermissionLevelPill\b/);
    expect(composerSrc).toMatch(/<BuildPlanTogglePill\b/);

    const pillSrc = readFileSync(permissionLevelPillPath, "utf8");
    const planSrc = readFileSync(buildPlanTogglePillPath, "utf8");
    const combined = pillSrc + planSrc;
    for (const mode of MODES) {
      const re = new RegExp(`["']${mode}["']`);
      expect(combined).toMatch(re);
    }
  });

  test("ChatComposer accepts `permissionMode` + `onPermissionModeChange` props", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/permissionMode\s*[:?]/);
    expect(src).toMatch(/onPermissionModeChange/);
  });

  test("ChatComposer wires `onPermissionModeChange` to the permission pills' change handlers", () => {
    const src = readFileSync(composerPath, "utf8");
    // Loose match: a pill change handler that invokes the prop. The
    // narrow contract is that *something* invokes onPermissionModeChange
    // (now via optional-chaining: `onPermissionModeChange?.(...)`).
    expect(src).toMatch(/onPermissionModeChange\??\.?\s*\(/);
  });
});

// Queue-priority block intentionally removed: the priority field was
// stripped from the wire when the SDK-era queue plumbing was retired.
// Every user-turn submit reaches the bridge unconditionally and rides
// the tmux pane's input order.

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

  test("chat-types `user-turn` body does not declare a `priority` field", () => {
    const src = readFileSync(typesPath, "utf8");
    // Regression tripwire: the dead priority field was stripped from
    // the wire. If it ever returns, this test surfaces the relapse.
    expect(src).not.toMatch(/priority\?\s*:\s*["'`]now["'`]/);
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
