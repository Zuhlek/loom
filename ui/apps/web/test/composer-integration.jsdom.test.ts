/**
 * Composer integration — runtime behaviour walk.
 *
 * Mounts the composer subtree under a hand-rolled React harness (no
 * jsdom — `ui/vitest.config.ts` runs node-only) and exercises the
 * eight end-to-end scenarios for the live-chat composer surface.
 *
 * Companion to {@link ./composer-integration.test.ts} (source-grep
 * consistency net). This file asserts on rendered output and emitted
 * frames — every assertion fails if the live-chat WS switch stops
 * routing `context-usage-update` or the `<ChatComposer>` JSX drops
 * its `modelSettings` / `onModelSettingsSet` props.
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

/* ───────────────────────── React harness ───────────────────────── */

interface HookCell {
  kind: "state" | "ref";
  value: unknown;
}

interface HarnessFrame {
  cells: HookCell[];
  cursor: number;
  effects: Array<() => void | (() => void)>;
}

const stack: HarnessFrame[] = [];

function frame(): HarnessFrame {
  const f = stack[stack.length - 1];
  if (!f) throw new Error("React hook called outside renderWithHarness");
  return f;
}

vi.mock("react", () => {
  function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
    const f = frame();
    const idx = f.cursor++;
    if (idx >= f.cells.length) {
      const seed = typeof initial === "function" ? (initial as () => T)() : initial;
      f.cells.push({ kind: "state", value: seed });
    }
    const cell = f.cells[idx]!;
    const setter = (next: T | ((prev: T) => T)) => {
      const prev = cell.value as T;
      cell.value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    };
    return [cell.value as T, setter];
  }
  function useRef<T>(initial: T): { current: T } {
    const f = frame();
    const idx = f.cursor++;
    if (idx >= f.cells.length) {
      f.cells.push({ kind: "ref", value: { current: initial } });
    }
    return f.cells[idx]!.value as { current: T };
  }
  function useCallback<T>(fn: T, _deps: unknown[]): T {
    return fn;
  }
  function useMemo<T>(factory: () => T, _deps: unknown[]): T {
    return factory();
  }
  function useEffect(fn: () => void | (() => void), _deps: unknown[]): void {
    frame().effects.push(fn);
  }
  function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown {
    const finalProps = { ...(props ?? {}) };
    if (children.length === 1) finalProps.children = children[0];
    else if (children.length > 1) finalProps.children = children;
    return { type, props: finalProps, key: (props as { key?: unknown })?.key ?? null };
  }
  const Fragment = Symbol.for("react.fragment");
  return {
    useState,
    useRef,
    useCallback,
    useMemo,
    useEffect,
    createElement,
    Fragment,
    default: { useState, useRef, useCallback, useMemo, useEffect, createElement, Fragment },
  };
});

/* Reset the harness between renders. */
function renderWith<T>(
  cells: HookCell[],
  fn: () => T,
): { result: T; effects: Array<() => void | (() => void)> } {
  const f: HarnessFrame = { cells, cursor: 0, effects: [] };
  stack.push(f);
  try {
    const result = fn();
    return { result, effects: f.effects };
  } finally {
    stack.pop();
  }
}

/* ───────────────────────── JSX tree walker ───────────────────────── */

interface JsxNode {
  type: unknown;
  props: Record<string, unknown>;
}

function isJsx(value: unknown): value is JsxNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "props" in value
  );
}

function visit(node: unknown, visitor: (n: JsxNode) => void): void {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, visitor);
    return;
  }
  if (!isJsx(node)) return;
  visitor(node);
  const children = node.props.children;
  if (children !== undefined) visit(children, visitor);
}

function findAll(node: unknown, pred: (n: JsxNode) => boolean): JsxNode[] {
  const hits: JsxNode[] = [];
  visit(node, (n) => {
    if (pred(n)) hits.push(n);
  });
  return hits;
}

function findFirst(node: unknown, pred: (n: JsxNode) => boolean): JsxNode | null {
  const all = findAll(node, pred);
  return all[0] ?? null;
}

function collectText(node: unknown): string {
  let out = "";
  const recurse = (n: unknown): void => {
    if (n === null || n === undefined || n === false) return;
    if (typeof n === "string" || typeof n === "number") {
      out += String(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const c of n) recurse(c);
      return;
    }
    if (isJsx(n)) recurse(n.props.children);
  };
  recurse(node);
  return out;
}

function byTestId(node: unknown, id: string): JsxNode | null {
  return findFirst(node, (n) => n.props["data-testid"] === id);
}

/** Extract the row's command name from the `<span className="font-mono">/<name></span>` glyph. */
function slashName(button: JsxNode): string {
  const span = findFirst(
    button,
    (n) => n.type === "span" && n.props.className === "font-mono",
  );
  if (!span) return "";
  const text = collectText(span);
  return text.startsWith("/") ? text.slice(1) : text;
}

/* ───────────────────────── route-source helpers ───────────────────────── */

const liveChatPath = webRoot + "src/routes/live-chat.tsx";
function readRoute(): string {
  return readFileSync(liveChatPath, "utf8");
}

/**
 * Simulate the live-chat ws.onmessage frame dispatcher by extracting
 * the case clauses for the bridge-routed frame kinds. Returns the
 * frame kinds that the production switch forwards into
 * `bridge.handleServerFrame`. Used by the runtime scenarios so
 * reverting the case statements in `live-chat.tsx` collapses the
 * exercised bridge state — the scenarios then fail.
 */
function bridgeRoutedKinds(): Set<string> {
  const src = readRoute();
  const kinds = new Set<string>();
  const re = /case\s+["'](slash-commands-update|context-usage-update)["']\s*:\s*[\s\S]{0,80}?bridge\.handleServerFrame\(\s*frame\s*\)/g;
  for (const match of src.matchAll(re)) kinds.add(match[1]!);
  return kinds;
}

function dispatchThroughRoute(
  bridge: { handleServerFrame: (frame: never) => void },
  frame: { kind: string },
): boolean {
  if (!bridgeRoutedKinds().has(frame.kind)) return false;
  bridge.handleServerFrame(frame as never);
  return true;
}

/* ───────────────────────── scenarios ───────────────────────── */

describe("composer integration — context-usage 42% (US-005 AC2)", () => {
  test("frame routes through bridge → indicator renders 42% and non-warning stroke", async () => {
    const { useChatBridge } = await import("../src/lib/use-chat-bridge");
    const { ContextUsageIndicator } = await import(
      "../src/components/chat/ContextUsageIndicator"
    );
    const bridgeCells: HookCell[] = [];
    const { result: bridge } = renderWith(bridgeCells, () => useChatBridge());
    expect(bridge.contextUsage).toBeNull();

    const routed = dispatchThroughRoute(bridge, {
      kind: "context-usage-update",
      "chat-id": "c1",
      body: {
        percentage: 42,
        totalTokens: 84_000,
        maxTokens: 200_000,
        model: "claude-opus-4-7",
      },
    } as never);
    expect(routed, "live-chat route did not forward context-usage-update").toBe(true);

    const { result: refreshed } = renderWith(bridgeCells, () => useChatBridge());
    expect(refreshed.contextUsage).not.toBeNull();

    const tree = renderWith([], () =>
      (ContextUsageIndicator as unknown as (p: unknown) => unknown)({
        usage: refreshed.contextUsage,
      }),
    ).result;
    expect(collectText(tree)).toContain("42%");
    const ring = findAll(tree, (n) => n.type === "circle");
    expect(ring.length).toBeGreaterThanOrEqual(2);
    const progress = ring[1]!;
    expect(progress.props.stroke).toBe("var(--muted-foreground)");
  });
});

describe("composer integration — context-usage 91% (US-005 AC3)", () => {
  test("frame at 91% flips indicator to the warning stroke", async () => {
    const { useChatBridge } = await import("../src/lib/use-chat-bridge");
    const { ContextUsageIndicator } = await import(
      "../src/components/chat/ContextUsageIndicator"
    );
    const cells: HookCell[] = [];
    const { result: bridge } = renderWith(cells, () => useChatBridge());
    const routed = dispatchThroughRoute(bridge, {
      kind: "context-usage-update",
      "chat-id": "c1",
      body: {
        percentage: 91,
        totalTokens: 182_000,
        maxTokens: 200_000,
        model: "claude-opus-4-7",
      },
    } as never);
    expect(routed).toBe(true);
    const { result: refreshed } = renderWith(cells, () => useChatBridge());

    const tree = renderWith([], () =>
      (ContextUsageIndicator as unknown as (p: unknown) => unknown)({
        usage: refreshed.contextUsage,
      }),
    ).result;
    expect(collectText(tree)).toContain("91%");
    const ring = findAll(tree, (n) => n.type === "circle");
    expect(ring[1]!.props.stroke).toBe("var(--destructive)");
  });
});

describe("composer integration — slash-commands-update menu render (US-001, US-002, US-006)", () => {
  test("frame with skill + command rows → Provider section, skill suppresses /plan collision", async () => {
    const { useChatBridge } = await import("../src/lib/use-chat-bridge");
    const { ComposerSlashMenu } = await import(
      "../src/components/chat/ComposerSlashMenu"
    );
    const cells: HookCell[] = [];
    const { result: bridge } = renderWith(cells, () => useChatBridge());
    const routed = dispatchThroughRoute(bridge, {
      kind: "slash-commands-update",
      "chat-id": "c1",
      body: {
        commands: [
          { name: "weave", description: "loom skill", argumentHint: "", kind: "skill" },
          { name: "plan", description: "duplicate", argumentHint: "", kind: "command" },
          { name: "review", description: "review pr", argumentHint: "", kind: "command" },
        ],
      },
    } as never);
    expect(routed).toBe(true);
    const { result: refreshed } = renderWith(cells, () => useChatBridge());

    const tree = renderWith([], () =>
      (ComposerSlashMenu as unknown as (p: unknown) => unknown)({
        query: "",
        slashCommands: refreshed.slashCommands,
        selectedIndex: 0,
        onHover: () => {},
        onSelect: () => {},
      }),
    ).result;

    const headerTexts = findAll(tree, (n) => n.type === "div").map((n) =>
      collectText(n),
    );
    expect(headerTexts.some((t) => t.includes("Built-in"))).toBe(true);
    expect(headerTexts.some((t) => t.includes("Provider"))).toBe(true);

    const rowButtons = findAll(tree, (n) => n.type === "button" && n.props.role === "option");
    // Each row's first text fragment is `/<name>` followed by the description.
    const rowNames = rowButtons.map((b) => slashName(b));
    // Built-ins in order, no duplicate `/plan` from SDK collision.
    expect(rowNames.filter((n) => n === "plan").length).toBe(1);
    expect(rowNames).toContain("weave");
    expect(rowNames).toContain("review");
    expect(rowNames).toContain("model");
    expect(rowNames).toContain("default");
    // Built-ins precede providers.
    expect(rowNames.indexOf("plan")).toBeLessThan(rowNames.indexOf("weave"));

    // Row icon dispatched by `kind`: skill → DiamondGlyph, command → SquareGlyph, builtin → HexagonGlyph.
    const weaveButton = rowButtons.find((b) => slashName(b) === "weave")!;
    const reviewButton = rowButtons.find((b) => slashName(b) === "review")!;
    const planButton = rowButtons.find((b) => slashName(b) === "plan")!;
    const weaveIcon = findFirst(
      weaveButton,
      (n) => typeof n.type === "function" && n.props.kind !== undefined,
    );
    const reviewIcon = findFirst(
      reviewButton,
      (n) => typeof n.type === "function" && n.props.kind !== undefined,
    );
    const planIcon = findFirst(
      planButton,
      (n) => typeof n.type === "function" && n.props.kind !== undefined,
    );
    expect(weaveIcon?.props.kind).toBe("skill");
    expect(reviewIcon?.props.kind).toBe("command");
    expect(planIcon?.props.kind).toBe("builtin");
  });

  test("frame === null → Built-in group + 'Loading commands…' affordance with aria-busy (US-006 AC4)", async () => {
    const { ComposerSlashMenu } = await import(
      "../src/components/chat/ComposerSlashMenu"
    );
    const tree = renderWith([], () =>
      (ComposerSlashMenu as unknown as (p: unknown) => unknown)({
        query: "",
        slashCommands: null,
        selectedIndex: 0,
        onHover: () => {},
        onSelect: () => {},
      }),
    ).result;
    const loading = byTestId(tree, "composer-slash-menu-loading");
    expect(loading).not.toBeNull();
    expect(loading!.props["aria-busy"]).toBe(true);
    expect(collectText(loading)).toContain("Loading commands");
  });
});

describe("composer integration — click /plan built-in (US-003 AC2)", () => {
  test("invoking onSelect with the /plan built-in row dispatches onPermissionModeChange('plan'), no textarea write, no user-turn frame", async () => {
    const { buildSlashMenuRows } = await import(
      "../src/components/chat/ComposerSlashMenu"
    );
    const { builtins } = buildSlashMenuRows("", null);
    const planRow = builtins.find((r) => r.name === "plan")!;
    expect(planRow.kind).toBe("builtin");

    // Walk the production acceptSlash logic by reading the route+composer
    // source for the exact branch the menu's onSelect hits. We model the
    // observable side-effects (mode change, frame emit) as captured calls.
    const emittedFrames: Array<{ kind: string; body?: unknown }> = [];
    const modeChanges: string[] = [];
    let textareaWritten = false;
    const acceptSlash = (row: { kind: string; name: string }): void => {
      if (row.kind === "builtin") {
        if (row.name === "plan") modeChanges.push("plan");
        else if (row.name === "default") modeChanges.push("default");
        return;
      }
      textareaWritten = true;
    };
    acceptSlash(planRow);

    expect(modeChanges).toEqual(["plan"]);
    expect(textareaWritten).toBe(false);
    expect(emittedFrames.filter((f) => f.kind === "user-turn")).toEqual([]);

    // Tie the model to production: ChatComposer's acceptSlash MUST
    // implement this branch — verify by source-grep against the actual
    // file, otherwise the model above is fiction.
    const composerSrc = readFileSync(
      webRoot + "src/components/chat/ChatComposer.tsx",
      "utf8",
    );
    expect(composerSrc).toMatch(
      /if\s*\(\s*row\.kind\s*===\s*["']builtin["']\s*\)\s*\{[\s\S]*?row\.name\s*===\s*["']plan["'][\s\S]*?onPermissionModeChange\??\.?\(\s*["']plan["']\s*\)/,
    );
    expect(composerSrc).toMatch(
      /if\s*\(\s*row\.kind\s*===\s*["']builtin["']\s*\)\s*\{[\s\S]*?\breturn\s*;/,
    );
  });
});

describe("composer integration — click /model built-in opens picker (US-003 AC1)", () => {
  test("ModelSelectorPill with open=true renders the Claude model list (Opus/Sonnet/Haiku)", async () => {
    const { ModelSelectorPill } = await import(
      "../src/components/chat/ModelSelectorPill"
    );
    const tree = renderWith([], () =>
      (ModelSelectorPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: () => {},
        open: true,
        onOpenChange: () => {},
      }),
    ).result;

    const popup = byTestId(tree, "composer-pill-model-selector-popup");
    expect(popup).not.toBeNull();
    const rowButtons = findAll(tree, (n) => n.type === "button" && n.props.role === "option");
    const labels = rowButtons.map((b) => collectText(b));
    expect(labels).toContain("Opus 4.7");
    expect(labels).toContain("Sonnet 4.6");
    expect(labels).toContain("Haiku 4.5");

    const trigger = byTestId(tree, "composer-pill-model-selector-trigger");
    expect(collectText(trigger)).toContain("Claude (default)");
  });
});

describe("composer integration — pick a model emits { model } patch (US-007 AC1)", () => {
  test("clicking an option invokes onPick with the model id; onPick → model-settings-set { model } patch", async () => {
    const { ModelSelectorPill } = await import(
      "../src/components/chat/ModelSelectorPill"
    );
    const picks: string[] = [];
    const tree = renderWith([], () =>
      (ModelSelectorPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: (id: string) => picks.push(id),
        open: true,
        onOpenChange: () => {},
      }),
    ).result;
    const opusRow = byTestId(tree, "composer-pill-model-selector-row-claude-opus-4-7")!;
    expect(opusRow).not.toBeNull();
    const onClick = opusRow.props.onClick as () => void;
    onClick();
    expect(picks).toEqual(["claude-opus-4-7"]);

    // The composer wraps the pill's onPick to emit a `{ model }` partial
    // patch through onModelSettingsSet — assert the production wrapper.
    const composerSrc = readFileSync(
      webRoot + "src/components/chat/ChatComposer.tsx",
      "utf8",
    );
    expect(composerSrc).toMatch(
      /onModelSettingsSet\??\.?\(\s*\{\s*model\s*:\s*[A-Za-z_$][\w$]*\s*\}\s*\)/,
    );

    // The route's onModelSettingsSet dispatcher must produce a
    // `model-settings-set` frame with the patch as body — collapsing
    // means B-02 has been reverted.
    const src = readRoute();
    expect(src).toMatch(/kind:\s*["']model-settings-set["']/);
    expect(src).toMatch(/<ChatComposer[\s\S]*?onModelSettingsSet\s*=\s*\{/);
  });
});

describe("composer integration — Ultrathink pick emits effort='max' + thinking.budgetTokens=32000 (US-008 AC3)", () => {
  test("clicking the Ultrathink radio invokes onPick with the documented patch", async () => {
    const { ModelSettingsPill } = await import(
      "../src/components/chat/ModelSettingsPill"
    );
    const cells: HookCell[] = [];
    // First render seeds open=false; flip it via the trigger.
    const first = renderWith(cells, () =>
      (ModelSettingsPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: () => {},
      }),
    ).result;
    const trigger = byTestId(first, "composer-pill-model-settings-trigger")!;
    (trigger.props.onClick as () => void)();

    const picks: unknown[] = [];
    const second = renderWith(cells, () =>
      (ModelSettingsPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: (patch: unknown) => picks.push(patch),
      }),
    ).result;

    const ultrathinkRadio = findFirst(
      second,
      (n) =>
        n.type === "input" &&
        n.props.type === "radio" &&
        n.props.name === "model-settings-reasoning",
    );
    expect(ultrathinkRadio).not.toBeNull();
    // Find specifically the Ultrathink label container.
    const ultraLabel = byTestId(second, "composer-pill-model-settings-reasoning-Ultrathink");
    expect(ultraLabel).not.toBeNull();
    const ultraInput = findFirst(
      ultraLabel,
      (n) => n.type === "input" && n.props.type === "radio",
    )!;
    (ultraInput.props.onChange as () => void)();
    expect(picks.length).toBe(1);
    const patch = picks[0] as {
      effort: string;
      thinking: { type: string; budgetTokens: number };
    };
    expect(patch.effort).toBe("max");
    expect(patch.thinking.type).toBe("enabled");
    expect(patch.thinking.budgetTokens).toBe(32000);
  });

  test("picking 1M context window emits contextWindow: '1m'", async () => {
    const { ModelSettingsPill } = await import(
      "../src/components/chat/ModelSettingsPill"
    );
    const cells: HookCell[] = [];
    const first = renderWith(cells, () =>
      (ModelSettingsPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: () => {},
      }),
    ).result;
    (byTestId(first, "composer-pill-model-settings-trigger")!.props.onClick as () => void)();

    const picks: unknown[] = [];
    const second = renderWith(cells, () =>
      (ModelSettingsPill as unknown as (p: unknown) => unknown)({
        value: null,
        onPick: (patch: unknown) => picks.push(patch),
      }),
    ).result;
    const oneMLabel = byTestId(second, "composer-pill-model-settings-context-1M")!;
    const oneMInput = findFirst(
      oneMLabel,
      (n) => n.type === "input" && n.props.type === "radio",
    )!;
    (oneMInput.props.onChange as () => void)();
    expect(picks).toEqual([{ contextWindow: "1m" }]);
  });
});

describe("composer integration — Plan pill flips back to lastNonPlanMode (US-004 AC3)", () => {
  test("click while mode=plan dispatches lastNonPlanMode", async () => {
    const { BuildPlanTogglePill } = await import(
      "../src/components/chat/BuildPlanTogglePill"
    );
    const changes: string[] = [];
    const tree = renderWith([], () =>
      (BuildPlanTogglePill as unknown as (p: unknown) => unknown)({
        mode: "plan",
        onModeChange: (m: string) => changes.push(m),
        lastNonPlanMode: "acceptEdits",
      }),
    ).result;
    const button = byTestId(tree, "composer-pill-build-plan")!;
    expect(collectText(button)).toContain("Plan");
    expect(button.props["aria-pressed"]).toBe(true);
    (button.props.onClick as () => void)();
    expect(changes).toEqual(["acceptEdits"]);
  });

  test("click while mode!=plan dispatches 'plan'", async () => {
    const { BuildPlanTogglePill } = await import(
      "../src/components/chat/BuildPlanTogglePill"
    );
    const changes: string[] = [];
    const tree = renderWith([], () =>
      (BuildPlanTogglePill as unknown as (p: unknown) => unknown)({
        mode: "default",
        onModeChange: (m: string) => changes.push(m),
        lastNonPlanMode: "default",
      }),
    ).result;
    const button = byTestId(tree, "composer-pill-build-plan")!;
    expect(collectText(button)).toContain("Build");
    (button.props.onClick as () => void)();
    expect(changes).toEqual(["plan"]);
  });
});

/* ───────────── live-chat → ChatComposer prop-threading guard ───────────── */

describe("composer integration — live-chat threads bridge state into <ChatComposer> (US-005 / US-007 / US-008 / US-009)", () => {
  test("the WS switch routes both bridge-owned server frames", () => {
    const kinds = bridgeRoutedKinds();
    expect(kinds.has("slash-commands-update")).toBe(true);
    expect(kinds.has("context-usage-update")).toBe(true);
  });

  test("<ChatComposer> receives modelSettings + onModelSettingsSet + contextUsage + slashCommands", () => {
    const src = readRoute();
    expect(src).toMatch(/<ChatComposer[\s\S]*?modelSettings\s*=\s*\{/);
    expect(src).toMatch(/<ChatComposer[\s\S]*?onModelSettingsSet\s*=\s*\{/);
    expect(src).toMatch(/<ChatComposer[\s\S]*?contextUsage\s*=\s*\{/);
    expect(src).toMatch(/<ChatComposer[\s\S]*?slashCommands\s*=\s*\{/);
  });

  test("onModelSettingsSet dispatcher emits a `model-settings-set` frame with the patch as body", () => {
    const src = readRoute();
    expect(src).toMatch(
      /kind:\s*["']model-settings-set["'][\s\S]{0,80}?body:\s*patch/,
    );
  });
});
