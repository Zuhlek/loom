// Render-and-interact tests for DiffPanelContainer.
//
// Mounts the component through a hand-rolled React harness (the
// established pattern in this codebase — see
// composer-integration.jsdom.test.ts) and asserts on rendered JSX
// output. The panel now shows ONE total diff; the turn-timeline strip
// and per-turn/whole scope toggle are gone.
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Stub the Snackbar provider context — DiffPanelContainer reads
// `useSnackbar()` for action feedback. Tests don't drive any
// snackbar-emitting interaction (no commit/push/pr click), so a
// no-op host is sufficient.
vi.mock("../src/components/ui/Snackbar", () => {
  const noop = () => {};
  return {
    useSnackbar: () => ({ show: noop, clear: noop }),
    SnackbarProvider: ({ children }: { children: unknown }) => children,
  };
});

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
  function useReducer<S, A>(
    reducer: (state: S, action: A) => S,
    initial: S,
  ): [S, (a: A) => void] {
    const [state, setState] = useState<S>(initial);
    const dispatch = (action: A): void => {
      setState((prev) => reducer(prev, action));
    };
    return [state, dispatch];
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
  // Minimal context shim: useContext returns the default value passed
  // to createContext. Sufficient for our tests since no Provider is
  // wrapping the rendered tree.
  function createContext<T>(defaultValue: T): { Provider: unknown; Consumer: unknown; _default: T } {
    return { Provider: Symbol("Provider"), Consumer: Symbol("Consumer"), _default: defaultValue };
  }
  function useContext<T>(ctx: { _default: T }): T {
    return ctx._default;
  }
  function forwardRef<T extends (...args: any[]) => any>(fn: T): T {
    return fn;
  }
  function useLayoutEffect(fn: () => void | (() => void), deps: unknown[]): void {
    frame().effects.push(fn);
    void deps;
  }
  return {
    useState,
    useRef,
    useCallback,
    useMemo,
    useEffect,
    useLayoutEffect,
    useReducer,
    useContext,
    createContext,
    forwardRef,
    createElement,
    Fragment,
    default: {
      useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect,
      useReducer, useContext, createContext, forwardRef, createElement, Fragment,
    },
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

// Cache of cells for nested function components so re-renders during
// the same test reuse hook state. Keyed by the component function
// identity + the index of its first appearance in render order.
const componentCellMap = new WeakMap<object, HookCell[][]>();

function visit(node: unknown, visitor: (n: JsxNode) => void): void {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, visitor);
    return;
  }
  if (!isJsx(node)) return;
  visitor(node);
  // If the node is a function component, render it with its own hook
  // frame and recurse into its output. Each occurrence gets its own
  // slot of cells so sibling instances don't share state.
  if (typeof node.type === "function") {
    let perComponent = componentCellMap.get(node.type as object);
    if (!perComponent) {
      perComponent = [];
      componentCellMap.set(node.type as object, perComponent);
    }
    const occurrenceIdx = visitCounter.idx++;
    if (!perComponent[occurrenceIdx]) perComponent[occurrenceIdx] = [];
    const cells = perComponent[occurrenceIdx]!;
    const { result } = renderWith(cells, () =>
      (node.type as (p: unknown) => unknown)(node.props),
    );
    visit(result, visitor);
    return;
  }
  const children = node.props.children;
  if (children !== undefined) visit(children, visitor);
}

const visitCounter = { idx: 0 };

function findAll(node: unknown, pred: (n: JsxNode) => boolean): JsxNode[] {
  visitCounter.idx = 0;
  const hits: JsxNode[] = [];
  visit(node, (n) => {
    if (pred(n)) hits.push(n);
  });
  return hits;
}

function findFirst(node: unknown, pred: (n: JsxNode) => boolean): JsxNode | null {
  visitCounter.idx = 0;
  const all: JsxNode[] = [];
  visit(node, (n) => {
    if (pred(n)) all.push(n);
  });
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
    if (!isJsx(n)) return;
    if (typeof n.type === "function") {
      // Expand function components with a transient hook frame. Tests
      // calling collectText typically do so AFTER findFirst already
      // rendered the tree once; cells stay populated on the WeakMap.
      const perComponent = componentCellMap.get(n.type as object) ?? [];
      const cells = perComponent[0] ?? [];
      const { result } = renderWith(cells, () =>
        (n.type as (p: unknown) => unknown)(n.props),
      );
      recurse(result);
      return;
    }
    recurse(n.props.children);
  };
  recurse(node);
  return out;
}

function byTestId(node: unknown, id: string): JsxNode | null {
  return findFirst(node, (n) => n.props["data-testid"] === id);
}

const webRoot = fileURLToPath(new URL("../", import.meta.url));

/* ───────────────────────── unconditional mount + empty state ───────────────────────── */

describe("DiffPanelContainer mounts for every chat and renders the empty-state badge", () => {
  test("vcsKind='git' with no changes → 'No changes on this branch yet.'", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: null,
        chatId: "c1",
        vcsKind: "git",
      }),
    );

    const shell = byTestId(tree, "diff-panel-container");
    expect(shell).not.toBeNull();

    const empty = byTestId(tree, "diff-empty");
    expect(empty).not.toBeNull();
    expect(collectText(empty)).toContain("No changes on this branch yet.");

    // The turn-timeline strip no longer exists.
    expect(byTestId(tree, "turn-timeline-strip")).toBeNull();
    expect(byTestId(tree, "turn-timeline-strip-empty")).toBeNull();
    // Nor the per-turn/whole scope toggle.
    expect(byTestId(tree, "diff-scope-per-turn")).toBeNull();
    expect(byTestId(tree, "diff-scope-whole")).toBeNull();
  });

  test("vcsKind='unknown' → 'non-git project' badge", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");
    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: null,
        chatId: "c1",
        vcsKind: "unknown",
      }),
    );
    const empty = byTestId(tree, "diff-empty");
    expect(empty).not.toBeNull();
    expect(collectText(empty)).toContain("non-git project");
  });

  test("the refresh button is present in the totals strip", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");
    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: null,
        chatId: "c1",
        vcsKind: "git",
      }),
    );
    expect(byTestId(tree, "diff-refresh")).not.toBeNull();
  });
});

/* ───────────────────────── live-chat route wiring ───────────────────────── */

describe("live-chat.tsx mounts <DiffPanelContainer> regardless of worktree_mode", () => {
  test("the rightDrawer JSX for rightPane==='diff' does NOT gate on worktree_mode==='worktree'", () => {
    const src = readFileSync(webRoot + "src/routes/live-chat.tsx", "utf8");
    const idx = src.indexOf("<DiffPanelContainer");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, idx - 300), idx);
    expect(window).not.toMatch(/worktree_mode\s*===\s*["']worktree["']/);
  });

  test("the rightDrawer JSX passes vcsKind and refreshSignal (not the removed checkpointTurns)", () => {
    const src = readFileSync(webRoot + "src/routes/live-chat.tsx", "utf8");
    const idx = src.indexOf("<DiffPanelContainer");
    expect(idx).toBeGreaterThan(-1);
    const close = src.indexOf("/>", idx);
    expect(close).toBeGreaterThan(-1);
    const element = src.slice(idx, close + 2);
    expect(element).toMatch(/vcsKind=\{/);
    expect(element).toMatch(/refreshSignal=\{/);
    expect(element).not.toMatch(/checkpointTurns=\{/);
  });
});
