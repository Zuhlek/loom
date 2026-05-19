/**
 * T-007 — Slash menu rewritten (grouped, iconed, loading affordance).
 *
 * Static-source contract tests against the rebuilt slash-menu layer.
 * Mirrors the project's node-only test style (no jsdom — see
 * `ui/vitest.config.ts`): string-grep against the component sources to
 * verify shape, ordering, and accessibility attributes.
 *
 * Covers:
 *   - `use-chat-bridge.ts` exists and exposes a `useChatBridge` hook
 *     that handles `slash-commands-update` frames and returns a nullable
 *     `WireSlashCommand[]`.
 *   - `ComposerSlashMenu.tsx` exists, declares the grouped layout
 *     (`Built-in` + `Provider` headers), the three built-in row names
 *     (`/model`, `/plan`, `/default`), the three inline SVG glyphs per
 *     ADR-D01 (hexagon / square / diamond), and the ADR-D02 loading
 *     affordance with `aria-busy="true"` when `slashCommands === null`.
 *   - `ChatComposer.tsx` re-wires the slash-menu state machine against a
 *     new bridge-supplied `slashCommands` prop, mounting
 *     `ComposerSlashMenu` and routing accepted SDK-provider rows back
 *     into the textarea as `/<name> `.
 *   - `live-chat.tsx` consumes `useChatBridge` and passes the catalog to
 *     `ChatComposer`.
 *
 * RED path:
 *   Before implementation, neither `use-chat-bridge.ts` nor
 *   `ComposerSlashMenu.tsx` exists on disk; the `existsSync` runtime
 *   assertions trip the red phase (NOT compile failure).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const hookPath = webRoot + "src/lib/use-chat-bridge.ts";
const menuPath = webRoot + "src/components/chat/ComposerSlashMenu.tsx";
const composerPath = webRoot + "src/components/chat/ChatComposer.tsx";
const liveChatPath = webRoot + "src/routes/live-chat.tsx";

describe("T-007 useChatBridge — slash-commands-update frame handling", () => {
  test("use-chat-bridge.ts exists at the documented path", () => {
    expect(existsSync(hookPath)).toBe(true);
  });

  test("exports a `useChatBridge` hook", () => {
    const src = readFileSync(hookPath, "utf8");
    expect(src).toMatch(/export\s+function\s+useChatBridge\b/);
  });

  test("hook handles the `slash-commands-update` frame kind", () => {
    const src = readFileSync(hookPath, "utf8");
    expect(src).toMatch(/slash-commands-update/);
  });

  test("hook exposes a nullable `slashCommands` field typed as `WireSlashCommand[] | null`", () => {
    const src = readFileSync(hookPath, "utf8");
    expect(src).toMatch(/WireSlashCommand/);
    expect(src).toMatch(/slashCommands/);
    // The hook returns null until the first frame lands.
    expect(src).toMatch(/null/);
  });
});

describe("T-007 ComposerSlashMenu — grouped layout + icons + loading", () => {
  test("ComposerSlashMenu.tsx exists at the documented path", () => {
    expect(existsSync(menuPath)).toBe(true);
  });

  test("declares a `ComposerSlashMenu` React component + its Props", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/export\s+(function|const)\s+ComposerSlashMenu\b/);
    expect(src).toMatch(/export\s+interface\s+ComposerSlashMenuProps\b/);
  });

  test("Props declare items / selectedIndex / onHover / onSelect / slashCommands", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/slashCommands\s*:/);
    expect(src).toMatch(/selectedIndex\s*:\s*number/);
    expect(src).toMatch(/onHover\s*:\s*\(/);
    expect(src).toMatch(/onSelect\s*:\s*\(/);
  });

  test("outer container is role='listbox' with a stable testid", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/role=["']listbox["']/);
    expect(src).toMatch(/data-testid=["']composer-slash-menu["']/);
  });

  test("renders 'Built-in' and 'Provider' group headers", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/Built-in/);
    expect(src).toMatch(/Provider/);
  });

  test("renders the three built-in command names in canonical order", () => {
    const src = readFileSync(menuPath, "utf8");
    const modelIdx = src.indexOf("model");
    const planIdx = src.indexOf("plan");
    const defaultIdx = src.indexOf("default");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeGreaterThan(-1);
    expect(defaultIdx).toBeGreaterThan(-1);
    // The built-in catalog appears as a constant array literal; the three
    // names must appear in declaration order: model, plan, default.
    expect(modelIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(defaultIdx);
  });

  test("renders three inline SVG glyphs per ADR-D01 (hexagon / square / diamond)", () => {
    const src = readFileSync(menuPath, "utf8");
    // Hexagon outline — built-in row icon.
    expect(src).toMatch(/12 2 21 7 21 17 12 22 3 17 3 7/);
    // Square outline — provider command row icon.
    expect(src).toMatch(/<rect[^/]*x=["']3["'][^/]*y=["']3["'][^/]*width=["']18["'][^/]*height=["']18["']/);
    // Diamond outline — skill row icon.
    expect(src).toMatch(/12 2 22 12 12 22 2 12/);
  });

  test("provider rows discriminate icon by `kind` ('skill' vs 'command')", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/["']skill["']/);
    expect(src).toMatch(/["']command["']/);
  });

  test("loading affordance fires when slashCommands === null (ADR-D02)", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/Loading commands/);
    expect(src).toMatch(/aria-busy=["']?\{?true/);
  });

  test("rows declare onMouseDown preventDefault (keep textarea focus)", () => {
    const src = readFileSync(menuPath, "utf8");
    expect(src).toMatch(/onMouseDown=\{[^}]*preventDefault\(\)/);
  });

  test("built-in name collisions suppress the SDK row (US-001 AC5)", () => {
    const src = readFileSync(menuPath, "utf8");
    // The provider section filters out names already in the built-in
    // constant array — this is expressed either via a `.filter` chain
    // or an explicit `BUILTIN_NAMES.has(name)` test.
    expect(src).toMatch(/filter|BUILTIN/);
  });
});

describe("T-007 ChatComposer — re-wires slash-menu state machine", () => {
  test("ChatComposer imports the new ComposerSlashMenu component", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*ComposerSlashMenu\s*\}\s*from\s*["']\.\/ComposerSlashMenu["']/,
    );
  });

  test("ChatComposer accepts a `slashCommands` prop typed as WireSlashCommand[] | null", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/slashCommands/);
    expect(src).toMatch(/WireSlashCommand/);
  });

  test("ChatComposer mounts <ComposerSlashMenu …/> when the slash trigger is active", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/<ComposerSlashMenu\b/);
  });

  test("ChatComposer reuses detectSlashCommandTrigger from composer-trigger", () => {
    const src = readFileSync(composerPath, "utf8");
    expect(src).toMatch(/detectSlashCommandTrigger/);
  });

  test("ChatComposer writes `/<name> ` to the textarea when a provider row is accepted", () => {
    const src = readFileSync(composerPath, "utf8");
    // The accept handler builds the replacement string `/<name> ` and
    // splices it via replaceTextRange (already imported pre-T-006).
    expect(src).toMatch(/replaceTextRange/);
    // Trailing space after the command name keeps the user one keystroke
    // away from arguments — mirrors the prior generic behaviour.
    expect(src).toMatch(/\/\$\{[^}]*name[^}]*\}\s*["'`]?\s*\+\s*["'`]\s["'`]|\/\$\{[^}]*\}\s/);
  });
});

describe("T-007 live-chat — wires useChatBridge into the route", () => {
  test("live-chat imports useChatBridge", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/useChatBridge/);
  });

  test("live-chat passes a `slashCommands` value to <ChatComposer>", () => {
    const src = readFileSync(liveChatPath, "utf8");
    expect(src).toMatch(/slashCommands=\{/);
  });
});
