/**
 * T-016 — production wiring fix-up for B-01, B-02, B-03.
 *
 * Three failures shipped to production:
 *   B-01: the live-chat WS switch never routes `context-usage-update`
 *         into the bridge hook, so `ContextUsageIndicator` always
 *         renders 0%.
 *   B-02: `<ChatComposer>` is mounted without `modelSettings` or
 *         `onModelSettingsSet`, so the ModelSelector and ModelSettings
 *         pills no-op on pick and always show defaults.
 *   B-03: web `ApiChat` does not declare `model_settings`, so the row
 *         carries no path from the persisted JSON column to the pills.
 *
 * Test strategy mirrors the existing static-source contract style used
 * across this test tier (`composer-integration.test.ts`,
 * `context-usage-indicator.test.ts`, etc.) and is augmented with a
 * runtime assertion against {@link useChatBridge}'s public
 * `handleServerFrame` contract — invoking the production code with a
 * synthetic `context-usage-update` frame must surface the body on the
 * hook's `contextUsage` field. The runtime path uses a small React shim
 * (no jsdom dependency — repo runs vitest under the node environment
 * per `ui/vitest.config.ts`).
 */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Module-scope React shim — captures every setState invocation in
 * `reactCaptured` so the runtime suite below can verify that the
 * bridge hook routes a `context-usage-update` frame to its setter.
 * Hoisted by vitest's `vi.mock` so it patches React BEFORE
 * `use-chat-bridge` resolves the import.
 */
const reactCaptured: Array<{ idx: number; value: unknown }> = [];
const reactCells: Array<unknown> = [];
let reactCursor = 0;

vi.mock("react", () => {
  function useState<T>(
    initial: T,
  ): [T, (next: T | ((prev: T) => T)) => void] {
    const idx = reactCursor++;
    if (idx >= reactCells.length) reactCells.push(initial);
    const setter = (next: T | ((prev: T) => T)) => {
      const prev = reactCells[idx] as T;
      const value =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      reactCells[idx] = value;
      reactCaptured.push({ idx, value });
    };
    return [reactCells[idx] as T, setter];
  }
  function useCallback<T>(fn: T, _deps: unknown[]): T {
    return fn;
  }
  return {
    useState,
    useCallback,
    default: { useState, useCallback },
  };
});

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const liveChatPath = webRoot + "src/routes/live-chat.tsx";
const apiPath = webRoot + "src/lib/api.ts";
const bridgePath = webRoot + "src/lib/use-chat-bridge.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("T-016 B-01 — live-chat routes `context-usage-update` into the bridge", () => {
  test("WS switch carries a `context-usage-update` case that calls bridge.handleServerFrame", () => {
    const src = read(liveChatPath);
    // The case must appear inside the ws.onmessage switch and forward
    // the frame to the bridge hook. Match the case label and the
    // bridge handoff on the same path.
    expect(src).toMatch(
      /case\s+["']context-usage-update["']\s*:\s*[\s\S]{0,80}?bridge\.handleServerFrame\(\s*frame\s*\)/,
    );
  });
});

describe("T-016 B-02 — live-chat threads modelSettings + onModelSettingsSet", () => {
  test("ChatComposer JSX receives `modelSettings={...}`", () => {
    const src = read(liveChatPath);
    expect(src).toMatch(/<ChatComposer[\s\S]*?modelSettings\s*=\s*\{/);
  });

  test("ChatComposer JSX receives `onModelSettingsSet={...}`", () => {
    const src = read(liveChatPath);
    expect(src).toMatch(/<ChatComposer[\s\S]*?onModelSettingsSet\s*=\s*\{/);
  });

  test("the route emits a `model-settings-set` client→server frame", () => {
    const src = read(liveChatPath);
    // The dispatcher passed as onModelSettingsSet must produce a frame
    // of kind `model-settings-set` so the server can persist the patch.
    expect(src).toMatch(/kind:\s*["']model-settings-set["']/);
  });

  test("the dispatcher carries the partial patch as `body`", () => {
    const src = read(liveChatPath);
    expect(src).toMatch(/body:\s*patch/);
  });
});

describe("T-016 B-03 — ApiChat carries the persisted model_settings JSON", () => {
  test("ApiChat declares `model_settings: WireModelSettings | null`", () => {
    const src = read(apiPath);
    expect(src).toMatch(
      /model_settings\s*:\s*WireModelSettings\s*\|\s*null/,
    );
  });

  test("api.ts imports WireModelSettings from chat-types", () => {
    const src = read(apiPath);
    expect(src).toMatch(
      /import\s+(?:type\s+)?\{[^}]*\bWireModelSettings\b[^}]*\}\s+from\s+["']\.\/chat-types["']/,
    );
  });
});

/**
 * Runtime assertion — the {@link useChatBridge} hook's public
 * `handleServerFrame` contract handles `context-usage-update` by
 * surfacing the frame body on `bridge.contextUsage`. Mocks React's
 * `useState` / `useCallback` so the hook can run under the node
 * vitest environment without a DOM or react-test-renderer.
 *
 * The static B-01 assertion above catches the route-side regression
 * (case re-deleted) and this runtime assertion catches the bridge-side
 * regression (frame body not propagated to the setter).
 */
describe("T-016 useChatBridge — runtime: context-usage-update updates contextUsage", () => {
  test("handleServerFrame({kind:'context-usage-update'}) updates the bridge's contextUsage", async () => {
    const mod = await import("../src/lib/use-chat-bridge");
    reactCursor = 0;
    reactCells.length = 0;
    reactCaptured.length = 0;
    const bridge = mod.useChatBridge();
    expect(bridge.contextUsage).toBeNull();
    const body = {
      percentage: 42,
      totalTokens: 84_000,
      maxTokens: 200_000,
      model: "claude-opus-4-7",
    };
    bridge.handleServerFrame({
      kind: "context-usage-update",
      "chat-id": "test-chat",
      body,
    } as any);
    const hit = reactCaptured.find((c) => c.value === body);
    expect(
      hit,
      "setContextUsage was not invoked with the frame body",
    ).toBeTruthy();
  });

  test("reset() clears the cached snapshot", async () => {
    const mod = await import("../src/lib/use-chat-bridge");
    reactCursor = 0;
    reactCells.length = 0;
    reactCaptured.length = 0;
    const bridge = mod.useChatBridge();
    bridge.reset();
    // Two setters, both invoked with null (slashCommands + contextUsage).
    const nulls = reactCaptured.filter((c) => c.value === null);
    expect(nulls.length).toBe(2);
  });
});

describe("T-016 useChatBridge contract — `context-usage-update` is the publicised kind", () => {
  // Belt-and-braces — keeps the hook honest if someone renames the kind
  // string while the route still forwards it (or vice versa).
  test("bridge source references the `context-usage-update` kind", () => {
    const src = read(bridgePath);
    expect(src).toMatch(/["']context-usage-update["']/);
  });
});
