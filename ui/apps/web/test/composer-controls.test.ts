/**
 * Composer permission-mode controls (web side).
 *
 * Post model-settings-modal refactor: the permission-mode controls
 * moved out of the composer footer into the {@link ChatSettingsModal}
 * (Mode = Build/Plan, Access = the three non-plan levels). The composer
 * still WRITES the mode through the `/plan` + `/default` built-in
 * slash-commands via `onPermissionModeChange`, and live-chat still emits
 * the typed `permission-mode-set` frame.
 *
 * Assertions are static-source string-grep against the source files
 * (test runtime is `node`, no jsdom — see `ui/vitest.config.ts`).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const typesPath = webRoot + "src/lib/chat-types.ts";
const settingsModalPath = webRoot + "src/components/chat/ChatSettingsModal.tsx";

// The four SDK PermissionMode values.
const MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;

describe("ChatSettingsModal — permission-mode controls", () => {
  test("ChatSettingsModal.tsx exists at the documented path", () => {
    expect(existsSync(settingsModalPath)).toBe(true);
  });

  test("the four SDK PermissionMode values are surfaced through the modal", () => {
    const src = readFileSync(settingsModalPath, "utf8");
    for (const mode of MODES) {
      const re = new RegExp(`["']${mode}["']`);
      expect(src).toMatch(re);
    }
  });

  test("the modal accepts `permissionMode` + `onPermissionModeChange` props", () => {
    const src = readFileSync(settingsModalPath, "utf8");
    expect(src).toMatch(/permissionMode\s*[:?]/);
    expect(src).toMatch(/onPermissionModeChange/);
  });

  test("the modal wires `onPermissionModeChange` to its Mode/Access controls", () => {
    const src = readFileSync(settingsModalPath, "utf8");
    expect(src).toMatch(/onPermissionModeChange\s*\(/);
  });
});

describe("ChatComposer — writes permission mode via slash-commands", () => {
  test("ChatComposer.tsx exists at the documented path", () => {
    expect(existsSync(composerPath)).toBe(true);
  });

  test("ChatComposer accepts an `onPermissionModeChange` prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onPermissionModeChange/);
  });

  test("ChatComposer forwards mode changes (e.g. /plan, /default) through the prop", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/onPermissionModeChange\??\.?\s*\(/);
  });
});

describe("chat-types mirror — PermissionMode + frame variants", () => {
  test("chat-types exports a `PermissionMode` union with the four SDK values", () => {
    const src = readFileSync(typesPath, "utf8");
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
    expect(src).not.toMatch(/priority\?\s*:\s*["'`]now["'`]/);
  });
});

describe("live-chat — frame emission + settings wiring", () => {
  test("live-chat dispatches a `permission-mode-set` frame on mode change", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/permission-mode-set/);
  });

  test("live-chat tracks `permissionMode` in reducer state and supplies it to the settings modal", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/permissionMode/);
    expect(src).toMatch(/<ChatSettingsModal\b/);
  });
});
