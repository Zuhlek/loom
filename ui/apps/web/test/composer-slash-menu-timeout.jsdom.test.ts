/**
 * F6 — slash menu loading affordance is time-bounded.
 *
 * The provider catalog arrives only via the bridge
 * `slash-commands-update` frame, sourced from the `claude` session. On
 * a cold/stuck session that frame may never land, so an unbounded
 * "Loading commands…" row would spin forever. {@link ComposerSlashMenu}
 * arms a one-shot timer ({@link SLASH_LOADING_TIMEOUT_MS}) and, once it
 * elapses, swaps the spinner row for a calm explainer.
 *
 * Companion runtime walk to {@link ./composer-slash-menu.test.ts} (the
 * node-only static-source net). Reuses the hand-rolled React harness
 * convention from {@link ./composer-integration.jsdom.test.ts}: hooks
 * are backed by a persistent cell array so a re-render reflects state
 * the timer mutated. With `vi.useFakeTimers()` we:
 *   1. render with `slashCommands={null}` → assert the
 *      `composer-slash-menu-loading` row (aria-busy=true) shows and the
 *      timeout row does NOT.
 *   2. run the mounted effects (arming the timer), advance fake time
 *      past `SLASH_LOADING_TIMEOUT_MS`, re-render → assert the
 *      `composer-slash-menu-loading-timeout` row (aria-busy=false) shows
 *      with the explainer copy and the spinner row is gone.
 */
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

afterEach(() => {
  vi.useRealTimers();
});

describe("F6 ComposerSlashMenu — bounded loading affordance", () => {
  test("null catalog shows the spinner, then the timeout explainer after SLASH_LOADING_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    const { ComposerSlashMenu } = await import(
      "../src/components/chat/ComposerSlashMenu"
    );
    const render = (cells: HookCell[]) =>
      renderWith(cells, () =>
        (ComposerSlashMenu as unknown as (p: unknown) => unknown)({
          query: "",
          slashCommands: null,
          selectedIndex: 0,
          onHover: () => {},
          onSelect: () => {},
        }),
      );

    // Persistent hook cells so the timer's state mutation survives re-render.
    const cells: HookCell[] = [];

    // 1. Initial render — spinner present, timeout explainer absent.
    const first = render(cells);
    const loadingRow = byTestId(first.result, "composer-slash-menu-loading");
    expect(loadingRow).not.toBeNull();
    expect(loadingRow!.props["aria-busy"]).toBe(true);
    expect(collectText(loadingRow)).toContain("Loading commands");
    expect(byTestId(first.result, "composer-slash-menu-loading-timeout")).toBeNull();

    // Mount effects (arms the bounded-loading timer).
    for (const effect of first.effects) effect();

    // 2. Advance past the bound, then re-render against the same cells.
    vi.advanceTimersByTime(8_000);
    const second = render(cells);
    const timeoutRow = byTestId(second.result, "composer-slash-menu-loading-timeout");
    expect(timeoutRow).not.toBeNull();
    expect(timeoutRow!.props["aria-busy"]).toBe(false);
    expect(collectText(timeoutRow)).toContain("Provider commands unavailable");
    // Spinner row is gone once timed out.
    expect(byTestId(second.result, "composer-slash-menu-loading")).toBeNull();
    // Provider header still renders in both states.
    expect(collectText(second.result)).toContain("Provider");
  });
});
