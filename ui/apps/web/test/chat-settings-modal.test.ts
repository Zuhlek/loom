/**
 * ChatSettingsModal — the per-chat settings surface opened from the gear
 * icon at the top-left of the composer element. Consolidates the
 * four settings that used to live as composer-footer pills:
 *   Model · Reasoning · Context window · Mode (Build/Plan) · Access.
 *
 * Model / reasoning / context emit partial `WireModelSettings` patches
 * via `onModelSettingsSet`; Mode + Access dispatch via
 * `onPermissionModeChange` — the same wire paths the old pills used.
 *
 * Test runtime is `node` (no jsdom — see `ui/vitest.config.ts`), so
 * assertions are static-source string-grep against the component file,
 * matching the project's pill-test convention.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const modalPath = webRoot + "src/components/chat/ChatSettingsModal.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";

function readModal(): string {
  return readFileSync(modalPath, "utf8");
}

describe("ChatSettingsModal — component contract", () => {
  test("ChatSettingsModal.tsx exists at the documented path", () => {
    expect(existsSync(modalPath)).toBe(true);
  });

  test("exports a `ChatSettingsModal` React component", () => {
    const src = readModal();
    expect(src).toMatch(/export\s+function\s+ChatSettingsModal\b/);
  });

  test("accepts the documented props", () => {
    const src = readModal();
    for (const prop of [
      "open",
      "onClose",
      "models",
      "modelSettings",
      "onModelSettingsSet",
      "permissionMode",
      "onPermissionModeChange",
    ]) {
      expect(src, `prop ${prop} must be declared`).toMatch(
        new RegExp(`\\b${prop}\\s*[:?]`),
      );
    }
  });

  test("returns null when not open (visibility gated on `open`)", () => {
    const src = readModal();
    expect(src).toMatch(/if\s*\(\s*!open\s*\)\s*return\s+null/);
  });
});

describe("ChatSettingsModal — sections", () => {
  test("renders Model / Reasoning / Context window / Mode / Access sections", () => {
    const src = readModal();
    for (const title of ["Model", "Reasoning", "Context window", "Mode", "Access"]) {
      expect(src, `section ${title} must be present`).toContain(`title="${title}"`);
    }
  });
});

describe("ChatSettingsModal — chat mutations (superset of the sidebar menu)", () => {
  test("accepts optional rename / fork / handoff props", () => {
    const src = readModal();
    for (const prop of ["chatName", "onRename", "onFork", "onHandoff"]) {
      expect(src, `prop ${prop} must be declared`).toMatch(new RegExp(`\\b${prop}\\s*[:?]`));
    }
  });

  test("renders a Name (rename) section wired to onRename", () => {
    const src = readModal();
    expect(src).toContain('title="Name"');
    expect(src).toMatch(/data-testid=["']chat-settings-name-input["']/);
    expect(src).toMatch(/onRename\(/);
  });

  test("empty name clears the custom name (onRename receives null)", () => {
    const src = readModal();
    // The submit helper maps a blank draft to null before dispatching.
    expect(src).toMatch(/length\s*>\s*0\s*\?\s*trimmed\s*:\s*null/);
  });

  test("renders an Actions section with Fork + Handoff wired to their props", () => {
    const src = readModal();
    expect(src).toContain('title="Actions"');
    // Testids are threaded through OptionCard's `testId` prop.
    expect(src).toContain("chat-settings-fork");
    expect(src).toContain("chat-settings-handoff");
    expect(src).toMatch(/onFork\(\)/);
    expect(src).toMatch(/onHandoff\(\)/);
  });
});

describe("ChatSettingsModal — dynamic model list", () => {
  test("maps model chips over the injected `models` prop (no hardcoded id catalog)", () => {
    const src = readModal();
    expect(src).toMatch(/modelList\.map\(/);
    expect(src).toMatch(/models\s*&&\s*models\.length/);
    expect(src).toMatch(/chat-settings-model-\$\{[^}]*\.id\}/);
    expect(src).toMatch(/onModelSettingsSet\(\s*\{\s*model:\s*m\.id\s*\}\s*\)/);
  });

  test("a Default chip clears the model override ({ model: null })", () => {
    const src = readModal();
    expect(src).toMatch(/onModelSettingsSet\(\s*\{\s*model:\s*null\s*\}\s*\)/);
  });
});

describe("ChatSettingsModal — reasoning + context patches", () => {
  test("Ultrathink maps to effort='max' + thinking.budgetTokens=32000 (type 'enabled')", () => {
    const src = readModal();
    expect(src).toMatch(/ULTRATHINK_BUDGET_TOKENS\s*=\s*32000/);
    expect(src).toMatch(/budgetTokens:\s*(?:ULTRATHINK_BUDGET_TOKENS|32000)/);
    expect(src).toMatch(/type:\s*["']enabled["']/);
    expect(src).toMatch(/effort:\s*["']max["']/);
  });

  test("context window chips carry the '200k' / '1m' patches", () => {
    const src = readModal();
    expect(src).toMatch(/contextWindow:\s*["']200k["']/);
    expect(src).toMatch(/contextWindow:\s*["']1m["']/);
  });

  test("reasoning + context chips dispatch onModelSettingsSet(row.patch)", () => {
    const src = readModal();
    expect(src).toMatch(/onModelSettingsSet\(\s*row\.patch\s*\)/);
  });
});

describe("ChatSettingsModal — Mode + Access permission dispatch", () => {
  test("Plan card dispatches onPermissionModeChange('plan')", () => {
    const src = readModal();
    expect(src).toMatch(/onPermissionModeChange\(\s*["']plan["']\s*\)/);
  });

  test("Build card restores the lastNonPlanMode ref", () => {
    const src = readModal();
    expect(src).toMatch(/lastNonPlanModeRef/);
    expect(src).toMatch(/onPermissionModeChange\(\s*lastNonPlanModeRef\.current\s*\)/);
  });

  test("Access section lists the three non-plan modes and dispatches onPermissionModeChange(row.value)", () => {
    const src = readModal();
    expect(src).toMatch(/onPermissionModeChange\(\s*row\.value\s*\)/);
    expect(src).toMatch(/value:\s*["']default["']/);
    expect(src).toMatch(/value:\s*["']acceptEdits["']/);
    expect(src).toMatch(/value:\s*["']bypassPermissions["']/);
    // 'plan' is NOT an Access row — it lives in the Mode section.
    expect(src).not.toMatch(/value:\s*["']plan["']/);
  });
});

describe("ChatSettingsModal — dismissal", () => {
  test("closes on Escape", () => {
    const src = readModal();
    expect(src).toMatch(/["']Escape["']/);
    expect(src).toMatch(/onClose\(\)/);
  });

  test("closes on backdrop click (target === currentTarget)", () => {
    const src = readModal();
    expect(src).toMatch(/e\.target\s*===\s*e\.currentTarget/);
  });

  test("emits the documented data-testids", () => {
    const src = readModal();
    expect(src).toMatch(/data-testid=["']chat-settings-modal["']/);
    expect(src).toMatch(/chat-settings-reasoning-/);
    expect(src).toMatch(/chat-settings-context-/);
    expect(src).toMatch(/chat-settings-mode-build/);
    expect(src).toMatch(/chat-settings-mode-plan/);
    expect(src).toMatch(/chat-settings-access-/);
  });
});

describe("ChatSettingsModal — wiring", () => {
  test("the composer renders the settings gear (top-left) wired to onOpenSettings", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/data-testid=["']chat-settings-gear["']/);
    expect(src).toMatch(/onOpenSettings\??\.?\(/);
  });

  test("live-chat mounts the modal and passes onOpenSettings to the composer", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/<ChatSettingsModal\b/);
    expect(src).toMatch(/onOpenSettings=\{/);
  });

  test("live-chat wires the rename / fork / handoff mutations into the modal", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/onRename=\{/);
    expect(src).toMatch(/onFork=\{/);
    expect(src).toMatch(/onHandoff=\{/);
    // The handlers call the REST endpoints.
    expect(src).toMatch(/renameChat\(/);
    expect(src).toMatch(/forkChat\(/);
    expect(src).toMatch(/handoffChat\(/);
  });
});
