/**
 * Composer integration smoke (browser scenario).
 *
 * End-to-end happy-path walk across the delivered composer surface: the
 * slash-menu loading affordance, the grouped Built-in / Provider
 * rendering with skill icons, the built-in dispatch branch, the footer
 * toolbar, the settings modal (model / reasoning / context / mode /
 * access), and the context-usage indicator.
 *
 * Post model-settings-modal refactor: the model / reasoning / mode /
 * access controls moved out of the footer pills into `ChatSettingsModal`,
 * opened from the gear anchored to the top-right of the chat window. The
 * old pill files are gone; this walk reads from the modal source instead.
 *
 * Runs under the project's node-only vitest runner — assertions are
 * static-source contract checks across the integrated component graph.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

const PATHS = {
  hook: webRoot + "src/lib/use-chat-bridge.ts",
  menu: webRoot + "src/components/chat/ComposerSlashMenu.tsx",
  composer: webRoot + "src/components/chat/ChatComposer.tsx",
  toolbar: webRoot + "src/components/chat/ComposerFooterToolbar.tsx",
  settingsModal: webRoot + "src/components/chat/ChatSettingsModal.tsx",
  contextUsage: webRoot + "src/components/chat/ContextUsageIndicator.tsx",
  liveChat: webRoot + "src/routes/live-chat.tsx",
  chatTypes: webRoot + "src/lib/chat-types.ts",
} as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("browser smoke — every wired file exists", () => {
  test("each integrated component / hook is present on disk", () => {
    for (const [name, path] of Object.entries(PATHS)) {
      expect(existsSync(path), `${name} missing at ${path}`).toBe(true);
    }
  });
});

describe("walk step 1 — initial render: slashCommands === null shows Loading affordance", () => {
  test("US-006 AC4 — menu renders 'Loading commands…' with aria-busy when null", () => {
    const src = read(PATHS.menu);
    expect(src).toMatch(/Loading commands/);
    expect(src).toMatch(/aria-busy=\{?true/);
  });

  test("US-001 AC3 — built-in group still renders /model, /plan, /default in canonical order", () => {
    const src = read(PATHS.menu);
    const modelIdx = src.indexOf('name: "model"');
    const planIdx = src.indexOf('name: "plan"');
    const defaultIdx = src.indexOf('name: "default"');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);
    expect(defaultIdx).toBeGreaterThan(-1);
    expect(modelIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(defaultIdx);
  });
});

describe("walk step 2 — slash-commands-update arrives: skills + provider group + built-in suppression", () => {
  test("useChatBridge stores the latest slash-commands-update payload", () => {
    const src = read(PATHS.hook);
    expect(src).toMatch(/slash-commands-update/);
    expect(src).toMatch(/slashCommands/);
    expect(src).toMatch(/setSlashCommands/);
  });

  test("US-001 AC5 — built-in name collisions suppress the SDK row", () => {
    const src = read(PATHS.menu);
    expect(src).toMatch(/BUILTIN_NAMES\.has\(c\.name\)/);
  });

  test("US-002 AC1 — provider rows discriminate icon by `kind`", () => {
    const src = read(PATHS.menu);
    expect(src).toMatch(/["']skill["']/);
    expect(src).toMatch(/["']command["']/);
    expect(src).toMatch(/12 2 21 7 21 17 12 22 3 17 3 7/);
    expect(src).toMatch(/<rect[^/]*x=["']3["'][^/]*y=["']3["']/);
    expect(src).toMatch(/12 2 22 12 12 22 2 12/);
  });

  test("US-006 AC5 — Provider group is sourced from the wire, not a filesystem scanner", () => {
    const src = read(PATHS.menu);
    expect(src).not.toMatch(/getSlashCommands\b/);
    expect(src).not.toMatch(/\bscan\.ts\b/);
    expect(src).not.toMatch(/\/slash-commands/);
  });
});

describe("walk step 3 — click /plan built-in: permission-mode-set + textarea untouched", () => {
  test("US-003 AC2 — /plan built-in dispatches onPermissionModeChange('plan')", () => {
    const src = read(PATHS.composer);
    expect(src).toMatch(/onPermissionModeChange\??\.?\(\s*["']plan["']\s*\)/);
  });

  test("US-003 AC3 — /default built-in dispatches onPermissionModeChange('default')", () => {
    const src = read(PATHS.composer);
    expect(src).toMatch(/onPermissionModeChange\??\.?\(\s*["']default["']\s*\)/);
  });

  test("US-003 AC1-AC3 — built-in branch returns BEFORE the textarea write", () => {
    const src = read(PATHS.composer);
    const acceptMatch = src.match(
      /const\s+acceptSlash\s*=\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
    );
    expect(acceptMatch).not.toBeNull();
    const body = acceptMatch![2];
    expect(body).toMatch(/builtin/);
    expect(body).toMatch(/return\s*;/);
    const builtinIdx = body.indexOf("builtin");
    const replaceIdx = body.indexOf("replaceTextRange");
    expect(builtinIdx).toBeLessThan(replaceIdx);
  });

  test("US-003 AC4 — provider rows still write `/<name> ` via replaceTextRange", () => {
    const src = read(PATHS.composer);
    expect(src).toMatch(/replaceTextRange/);
    expect(src).toMatch(/`\/\$\{[^}]*name[^}]*\}\s`/);
  });
});

describe("walk step 4 — click /model built-in: settings modal opens", () => {
  test("US-003 AC1 — /model built-in invokes onOpenSettings?.()", () => {
    const src = read(PATHS.composer);
    expect(src).toMatch(/onOpenSettings\??\.?\(\s*\)/);
  });

  test("composer renders the settings gear (top-left); live-chat mounts <ChatSettingsModal> wired to onOpenSettings", () => {
    const composerSrc = read(PATHS.composer);
    expect(composerSrc).toMatch(/data-testid=["']chat-settings-gear["']/);
    const liveSrc = read(PATHS.liveChat);
    expect(liveSrc).toMatch(/<ChatSettingsModal\b/);
    expect(liveSrc).toMatch(/onOpenSettings=\{/);
  });
});

describe("walk step 5 — pick a model: emits model-settings-set { model }", () => {
  test("US-007 AC1 — the model chip dispatches onModelSettingsSet({ model: <id> })", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/onModelSettingsSet\(\s*\{\s*model:\s*m\.id\s*\}\s*\)/);
  });

  test("US-007 AC4 — the model list is dynamic (mapped from the `models` prop, no hardcoded catalog)", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/modelList\.map\(/);
    expect(src).toMatch(/\blabel\b/);
    // The id/label pairs come from the injected prop, not a literal
    // model-id catalog baked into the component.
    expect(src).toMatch(/models\s*&&\s*models\.length/);
  });
});

describe("walk step 6 — Ultrathink pick: model-settings-set { effort: 'max', thinking: { budgetTokens: 32000 } }", () => {
  test("US-008 AC3 — Ultrathink maps to effort='max' + thinking.budgetTokens=32000", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/["']max["']/);
    expect(src).toMatch(/budgetTokens:\s*(?:ULTRATHINK_BUDGET_TOKENS|32000)/);
    expect(src).toMatch(/ULTRATHINK_BUDGET_TOKENS\s*=\s*32000/);
    expect(src).toMatch(/type:\s*["']enabled["']/);
  });

  test("US-008 AC3 — 1M context window maps to contextWindow: '1m'", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/["']1m["']/);
    expect(src).toMatch(/["']200k["']/);
  });

  test("US-008 AC4 — modal surfaces the reasoning + context labels", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/Ultrathink/);
    expect(src).toMatch(/Extra High/);
    expect(src).toMatch(/200k/);
    expect(src).toMatch(/1M/);
  });
});

describe("walk step 7 — context-usage frame at 42% / 91%: ring updates + warning state", () => {
  test("US-005 AC2 — indicator renders the bridge-reported percentage", () => {
    const src = read(PATHS.contextUsage);
    expect(src).toMatch(/percentage/);
  });

  test("US-005 AC3 — indicator switches to a warning treatment at >=90%", () => {
    const src = read(PATHS.contextUsage);
    expect(src).toMatch(/WARNING_THRESHOLD\s*=\s*90/);
  });

  test("US-005 AC4 — null contextUsage renders 0%", () => {
    const src = read(PATHS.contextUsage);
    expect(src).toMatch(/usage\s*\?\s*[^:]+:\s*0/);
  });

  test("useChatBridge handles context-usage-update frames", () => {
    const src = read(PATHS.hook);
    expect(src).toMatch(/context-usage-update/);
    expect(src).toMatch(/setContextUsage/);
  });
});

describe("walk step 8 — Mode + Access in the settings modal", () => {
  test("US-004 AC2 — Plan card sets mode to 'plan'", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/onPermissionModeChange\(\s*["']plan["']\s*\)/);
  });

  test("US-004 AC3 — Build card returns to lastNonPlanMode", () => {
    const src = read(PATHS.settingsModal);
    expect(src).toMatch(/onPermissionModeChange\(\s*lastNonPlanModeRef\.current\s*\)/);
  });

  test("US-004 AC4 — the Access section does NOT list a 'plan' row (Plan lives in the Mode section)", () => {
    const src = read(PATHS.settingsModal);
    // The three access levels are present…
    expect(src).toMatch(/value:\s*["']default["']/);
    expect(src).toMatch(/value:\s*["']acceptEdits["']/);
    expect(src).toMatch(/value:\s*["']bypassPermissions["']/);
    // …and 'plan' is not one of the ACCESS_ROWS values.
    expect(src).not.toMatch(/value:\s*["']plan["']/);
  });
});

describe("footer-toolbar integration — workspace + context-usage + send button", () => {
  const SLOTS = ["workspace", "contextUsage"] as const;

  test("toolbar declares the remaining named slots + sendButton", () => {
    const src = read(PATHS.toolbar);
    for (const slot of SLOTS) {
      expect(src).toMatch(new RegExp(`\\b${slot}\\s*\\??\\s*:`));
    }
    expect(src).toMatch(/\bsendButton\s*\??\s*:/);
  });

  test("toolbar renders slots in documented left-to-right order", () => {
    const src = read(PATHS.toolbar);
    const order = [...SLOTS, "sendButton"] as const;
    const positions = order.map((slot) => {
      const re = new RegExp(`\\{\\s*${slot}\\s*\\}`);
      const match = src.match(re);
      expect(match, `${slot} must be interpolated as {${slot}}`).not.toBeNull();
      return src.indexOf(match![0]);
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("toolbar no longer carries the migrated setting-pill slots", () => {
    const src = read(PATHS.toolbar);
    expect(src).not.toMatch(/\bmodelSelector\b/);
    expect(src).not.toMatch(/\bmodelSettings\b/);
    expect(src).not.toMatch(/\bbuildPlanToggle\b/);
    expect(src).not.toMatch(/\bpermissionLevel\b/);
  });

  test("ChatComposer mounts the toolbar with the remaining slots wired", () => {
    const src = read(PATHS.composer);
    expect(src).toMatch(/<ComposerFooterToolbar\b/);
    expect(src).toMatch(/contextUsage=\{/);
    expect(src).toMatch(/sendButton=\{/);
  });
});

describe("live-chat integration — useChatBridge feeds ChatComposer + ChatSettingsModal", () => {
  test("live-chat consumes useChatBridge", () => {
    const src = read(PATHS.liveChat);
    expect(src).toMatch(/useChatBridge/);
  });

  test("live-chat passes slashCommands to ChatComposer", () => {
    const src = read(PATHS.liveChat);
    expect(src).toMatch(/slashCommands=\{/);
  });

  test("live-chat passes contextUsage to ChatComposer (US-005 wire)", () => {
    const src = read(PATHS.liveChat);
    expect(src).toMatch(/contextUsage=\{|contextUsage:\s*/);
  });

  test("live-chat threads modelSettings + onModelSettingsSet into <ChatSettingsModal>", () => {
    const src = read(PATHS.liveChat);
    expect(src).toMatch(/<ChatSettingsModal[\s\S]*?modelSettings\s*=\s*\{/);
    expect(src).toMatch(/<ChatSettingsModal[\s\S]*?onModelSettingsSet\s*=\s*\{/);
  });
});

describe("FS-scanner smoke guard — no residual references on the walk", () => {
  test("ChatComposer does not reference the deleted scanner or its client fetch", () => {
    const src = read(PATHS.composer);
    expect(src).not.toMatch(/getSlashCommands\b/);
    expect(src).not.toMatch(/SlashCommandEntry\b/);
    expect(src).not.toMatch(/["']\/slash-commands["']/);
  });

  test("ComposerSlashMenu does not reference the deleted scanner", () => {
    const src = read(PATHS.menu);
    expect(src).not.toMatch(/getSlashCommands\b/);
    expect(src).not.toMatch(/SlashCommandEntry\b/);
  });

  test("live-chat does not reference the deleted scanner / fetch / cwd-driven useEffect", () => {
    const src = read(PATHS.liveChat);
    expect(src).not.toMatch(/getSlashCommands\b/);
    expect(src).not.toMatch(/SlashCommandEntry\b/);
    expect(src).not.toMatch(/["']\/slash-commands["']/);
  });

  test("useChatBridge does not reference the deleted scanner", () => {
    const src = read(PATHS.hook);
    expect(src).not.toMatch(/getSlashCommands\b/);
    expect(src).not.toMatch(/SlashCommandEntry\b/);
  });
});

describe("wire-shape smoke — chat-types mirror carries the three new frames", () => {
  test("chat-types declares the slash-commands-update frame kind", () => {
    const src = read(PATHS.chatTypes);
    expect(src).toMatch(/kind:\s*["']slash-commands-update["']/);
  });

  test("chat-types declares the context-usage-update frame kind", () => {
    const src = read(PATHS.chatTypes);
    expect(src).toMatch(/kind:\s*["']context-usage-update["']/);
  });

  test("chat-types declares the model-settings-set frame kind", () => {
    const src = read(PATHS.chatTypes);
    expect(src).toMatch(/kind:\s*["']model-settings-set["']/);
  });

  test("chat-types declares WireSlashCommand + WireModelSettings", () => {
    const src = read(PATHS.chatTypes);
    expect(src).toMatch(/WireSlashCommand\b/);
    expect(src).toMatch(/WireModelSettings\b/);
  });
});
