/**
 * F7 — degraded RAW WebSocket connection is surfaced inline.
 *
 * Before this fix the only signal of a dropped browser↔loom-server
 * socket was the ~6px `conn-status-dot` in the far bottom-right rail.
 * {@link ConnectionBanner} adds a slim inline banner in the timeline
 * region (alongside, but never stacking with, `SessionRecoveryBanner`).
 *
 * This walks the component's gating + grace logic with the same
 * hand-rolled React harness + `vi.useFakeTimers()` convention as
 * {@link ./composer-slash-menu-timeout.jsdom.test.ts}: hook state lives
 * in a persistent cell array so a re-render reflects what the grace
 * timer mutated. Cases:
 *   (a) conn="open"                  → null (nothing degraded).
 *   (b) lifecycle="recovering"       → null even when conn degraded
 *                                      (SessionRecoveryBanner owns it —
 *                                      no stacking).
 *   (c) conn="connecting", active    → null BEFORE grace; yellow banner
 *                                      AFTER advancing past
 *                                      CONN_BANNER_GRACE_MS.
 *   (d) conn="closed", active        → red banner (after grace) with
 *                                      "Connection lost".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

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
  if (!f) throw new Error("React hook called outside renderWith");
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
    useEffect,
    createElement,
    Fragment,
    default: { useState, useRef, useEffect, createElement, Fragment },
  };
});

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
    typeof value === "object" && value !== null && "type" in value && "props" in value
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

function byTestId(node: unknown, id: string): JsxNode | null {
  let hit: JsxNode | null = null;
  visit(node, (n) => {
    if (hit === null && n.props["data-testid"] === id) hit = n;
  });
  return hit;
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

/* ───────────────────────── scenario ───────────────────────── */

type ConnState = "idle" | "connecting" | "open" | "closed";
type SessionLifecycle = "active" | "recovering" | "failed";

afterEach(() => {
  vi.useRealTimers();
});

describe("F7 ConnectionBanner — inline transport-degradation notice", () => {
  async function load() {
    const mod = await import("../src/components/chat/ConnectionBanner");
    return mod;
  }

  function makeRender(
    ConnectionBanner: unknown,
    props: { conn: ConnState; lifecycle: SessionLifecycle },
  ) {
    return (cells: HookCell[]) =>
      renderWith(cells, () =>
        (ConnectionBanner as (p: unknown) => unknown)(props),
      );
  }

  test("(a) conn=open → renders null", async () => {
    vi.useFakeTimers();
    const { ConnectionBanner } = await load();
    const render = makeRender(ConnectionBanner, { conn: "open", lifecycle: "active" });
    const cells: HookCell[] = [];
    const { result, effects } = render(cells);
    expect(result).toBeNull();
    for (const e of effects) e();
    vi.advanceTimersByTime(5_000);
    expect(render(cells).result).toBeNull();
  });

  test("(b) lifecycle=recovering → null even when conn degraded (no stacking)", async () => {
    vi.useFakeTimers();
    const { ConnectionBanner } = await load();
    const render = makeRender(ConnectionBanner, {
      conn: "closed",
      lifecycle: "recovering",
    });
    const cells: HookCell[] = [];
    const { result, effects } = render(cells);
    expect(result).toBeNull();
    for (const e of effects) e();
    vi.advanceTimersByTime(5_000);
    expect(render(cells).result).toBeNull();
  });

  test("(c) conn=connecting, active → null before grace, yellow banner after", async () => {
    vi.useFakeTimers();
    const { ConnectionBanner, CONN_BANNER_GRACE_MS } = await load();
    const render = makeRender(ConnectionBanner, {
      conn: "connecting",
      lifecycle: "active",
    });
    const cells: HookCell[] = [];

    // 1. Before the grace timer fires → no banner.
    const first = render(cells);
    expect(byTestId(first.result, "connection-banner")).toBeNull();
    for (const e of first.effects) e();

    // 2. Advance past the grace window → yellow banner appears.
    vi.advanceTimersByTime(CONN_BANNER_GRACE_MS + 1);
    const second = render(cells);
    const banner = byTestId(second.result, "connection-banner");
    expect(banner).not.toBeNull();
    expect(banner!.props["role"]).toBe("alert");
    expect(banner!.props["data-conn"]).toBe("connecting");
    expect(collectText(banner)).toContain("Reconnecting");
    // Yellow (soft) palette, not the red hard one.
    const style = banner!.props["style"] as Record<string, string>;
    expect(style.background).toContain("234,179,8");
  });

  test("(d) conn=closed, active → red banner after grace with 'Connection lost'", async () => {
    vi.useFakeTimers();
    const { ConnectionBanner, CONN_BANNER_GRACE_MS } = await load();
    const render = makeRender(ConnectionBanner, {
      conn: "closed",
      lifecycle: "active",
    });
    const cells: HookCell[] = [];

    const first = render(cells);
    expect(byTestId(first.result, "connection-banner")).toBeNull();
    for (const e of first.effects) e();

    vi.advanceTimersByTime(CONN_BANNER_GRACE_MS + 1);
    const banner = byTestId(render(cells).result, "connection-banner");
    expect(banner).not.toBeNull();
    expect(banner!.props["data-conn"]).toBe("closed");
    expect(collectText(banner)).toContain("Connection lost");
    // Red (hard) palette.
    const style = banner!.props["style"] as Record<string, string>;
    expect(style.background).toContain("239,68,68");
  });

  test("live-chat wires <ConnectionBanner conn lifecycle> in the banner region", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/routes/live-chat.tsx", import.meta.url)),
      "utf8",
    );
    expect(src).toContain('from "../components/chat/ConnectionBanner"');
    expect(src).toMatch(/<ConnectionBanner\s+conn=\{conn\}\s+lifecycle=\{state\.lifecycle\}/);
  });
});
