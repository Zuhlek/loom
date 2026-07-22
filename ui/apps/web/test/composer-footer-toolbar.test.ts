/**
 * `ComposerFooterToolbar` — pure layout container for the composer
 * footer row.
 *
 * Post model-settings-modal refactor: the model / reasoning / mode /
 * access pills moved out of the footer into the {@link ChatSettingsModal}
 * (opened from the gear anchored to the top-right of the chat window).
 * The footer now carries only the ambient, non-setting affordances:
 *
 *   workspace · <spacer> · ContextUsageIndicator · send button
 *
 * Assertions are static-source string-grep against the component files
 * (test runtime is `node`, no jsdom — see `ui/vitest.config.ts`).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const toolbarPath = webRoot + "src/components/chat/ComposerFooterToolbar.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

// Remaining named slots, left-to-right, plus the send button. Order matters.
const SLOT_NAMES = ["workspace", "contextUsage"] as const;

describe("ComposerFooterToolbar — pure layout container", () => {
  test("ComposerFooterToolbar.tsx exists at the documented path", () => {
    expect(existsSync(toolbarPath)).toBe(true);
  });

  test("declares a `ComposerFooterToolbar` React component", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ComposerFooterToolbar\b/);
  });

  test("accepts workspace + contextUsage slots + a send button slot", () => {
    const src = readFileSync(toolbarPath, "utf8");
    for (const slot of SLOT_NAMES) {
      const re = new RegExp(`\\b${slot}\\s*\\??\\s*:`);
      expect(src).toMatch(re);
    }
    expect(src).toMatch(/\bsendButton\s*\??\s*:/);
  });

  test("no longer carries the migrated setting-pill slots", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).not.toMatch(/\bmodelSelector\b/);
    expect(src).not.toMatch(/\bmodelSettings\b/);
    expect(src).not.toMatch(/\bbuildPlanToggle\b/);
    expect(src).not.toMatch(/\bpermissionLevel\b/);
  });

  test("renders the slots in the documented left-to-right order", () => {
    const src = readFileSync(toolbarPath, "utf8");
    const order = [...SLOT_NAMES, "sendButton"] as const;
    const positions = order.map((slot) => {
      const re = new RegExp(`\\{\\s*${slot}\\s*\\}`);
      const match = src.match(re);
      expect(match, `slot ${slot} must be interpolated as {${slot}} in JSX`).not.toBeNull();
      return src.indexOf(match![0]);
    });
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `slot ${order[i]} must appear AFTER ${order[i - 1]} in the JSX`,
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("send button is the rightmost child (after the context-usage slot)", () => {
    const src = readFileSync(toolbarPath, "utf8");
    const usageIdx = src.indexOf("{contextUsage}");
    const sendIdx = src.indexOf("{sendButton}");
    expect(usageIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(usageIdx);
  });

  test("contains no internal state — no useState / useReducer / useEffect", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).not.toMatch(/\buseState\b/);
    expect(src).not.toMatch(/\buseReducer\b/);
    expect(src).not.toMatch(/\buseEffect\b/);
  });

  test("contains no fetch or WebSocket calls", () => {
    const src = readFileSync(toolbarPath, "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bWebSocket\b/);
  });
});

describe("ChatComposer — mounts ComposerFooterToolbar", () => {
  test("ChatComposer imports ComposerFooterToolbar", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/import\s*\{\s*ComposerFooterToolbar\s*\}\s*from\s*["']\.\/ComposerFooterToolbar["']/);
  });

  test("ChatComposer renders <ComposerFooterToolbar … />", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ComposerFooterToolbar\b/);
  });

  test("ChatComposer passes the remaining slots + send button to the toolbar", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/contextUsage=\{/);
    expect(src).toMatch(/sendButton=\{/);
  });

  test("ChatComposer no longer mounts the migrated setting pills", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).not.toMatch(/<ModelSelectorPill\b/);
    expect(src).not.toMatch(/<ModelSettingsPill\b/);
    expect(src).not.toMatch(/<BuildPlanTogglePill\b/);
    expect(src).not.toMatch(/<PermissionLevelPill\b/);
  });
});
