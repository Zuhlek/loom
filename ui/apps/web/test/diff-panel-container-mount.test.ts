// B2 + B3 render-and-interact tests for DiffPanelContainer.
//
// The Build-2 version of this test file source-grepped the component
// for literal strings, so the gates that defeat the spec at runtime
// passed silently. This version mounts the component through a hand-
// rolled React harness (the established pattern in this codebase —
// see composer-integration.jsdom.test.ts) and asserts on rendered
// JSX output + click-driven state changes.
//
// Each block has a Red→Green pre-condition documented inline.
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

/* ───────────────────────── B2: unconditional mount + props ───────────────────────── */

describe("B2 — DiffPanelContainer mounts for local-mode chats and renders the empty-state badge", () => {
  test("renders the panel shell for a chat with vcsKind='git' and zero checkpointTurns (no per-turn history badge)", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    // Stub the global fetch so the initial-mount status/diff calls
    // don't try to reach a server. They settle later via the harness's
    // effect runner — for the render assertion we only need the first
    // synchronous render output.
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sections: [], branch: "main", base: "main", ahead: 0, behind: 0, uncommitted: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    try {
      const cells: HookCell[] = [];
      const { result: tree } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [],
        }),
      );

      // The panel shell is in the document. Build-2 would fail this
      // assertion because the caller (live-chat) refused to mount the
      // panel for local-mode chats; here we exercise the panel's own
      // render path directly with the local-mode prop shape.
      const shell = byTestId(tree, "diff-panel-container");
      expect(shell).not.toBeNull();

      // Empty-state badge for vcsKind='git' + no refs → "no per-turn
      // history". This is the US-005 AC6 empty-state copy.
      const empty = byTestId(tree, "diff-empty");
      expect(empty).not.toBeNull();
      expect(collectText(empty)).toContain("no per-turn history");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("renders the 'non-git project' badge when vcsKind='unknown'", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");
    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: null,
        chatId: "c1",
        vcsKind: "unknown",
        checkpointTurns: [],
      }),
    );
    const empty = byTestId(tree, "diff-empty");
    expect(empty).not.toBeNull();
    expect(collectText(empty)).toContain("non-git project");

    // The empty-state branch of the timeline-strip also renders the
    // badge under the "unknown" copy.
    const stripEmpty = byTestId(tree, "turn-timeline-strip-empty");
    expect(stripEmpty).not.toBeNull();
    expect(collectText(stripEmpty)).toContain("non-git project");
  });

  test("renders the timeline strip with N markers when checkpointTurns is non-empty", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");
    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: null,
        chatId: "c1",
        vcsKind: "git",
        checkpointTurns: [0, 1, 2],
      }),
    );
    const strip = byTestId(tree, "turn-timeline-strip");
    expect(strip).not.toBeNull();
    // 3 markers + the "whole" marker = 4 buttons.
    const buttons = findAll(strip, (n) => n.type === "button");
    expect(buttons.length).toBe(4);
    const marker0 = byTestId(strip, "turn-marker-0");
    const marker1 = byTestId(strip, "turn-marker-1");
    const marker2 = byTestId(strip, "turn-marker-2");
    expect(marker0).not.toBeNull();
    expect(marker1).not.toBeNull();
    expect(marker2).not.toBeNull();
  });
});

/* ───────────────────────── B2: live-chat route mounts panel for local-mode chats ───────────────────────── */

describe("B2 — live-chat.tsx mounts <DiffPanelContainer> regardless of worktree_mode", () => {
  test("the rightDrawer JSX for rightPane==='diff' does NOT gate on worktree_mode==='worktree'", () => {
    // This stays a source assertion because the live-chat route is a
    // heavy parent (AppLayout, sidebar, websocket attach). The intent
    // here is to anchor a regression — the gate that defeated B2 must
    // be gone. The Build-2 source had the literal `worktree_mode ===
    // "worktree"` adjacent to `<DiffPanelContainer`; we assert it is
    // not adjacent any more by requiring the conditional branch be
    // `rightPane === "diff" && chat` (truthy on any mode).
    const src = readFileSync(webRoot + "src/routes/live-chat.tsx", "utf8");
    // The conditional that renders DiffPanelContainer must NOT include
    // `worktree_mode === "worktree"` in the same branch expression.
    // We look up the line that contains `<DiffPanelContainer` and
    // inspect a ~200-char window above it.
    const idx = src.indexOf("<DiffPanelContainer");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, idx - 300), idx);
    expect(window).not.toMatch(/worktree_mode\s*===\s*["']worktree["']/);
  });

  test("the rightDrawer JSX passes vcsKind and checkpointTurns to DiffPanelContainer", () => {
    const src = readFileSync(webRoot + "src/routes/live-chat.tsx", "utf8");
    // Find the DiffPanelContainer element and look ahead through its
    // self-closing tag for the two required props.
    const idx = src.indexOf("<DiffPanelContainer");
    expect(idx).toBeGreaterThan(-1);
    const close = src.indexOf("/>", idx);
    expect(close).toBeGreaterThan(-1);
    const element = src.slice(idx, close + 2);
    expect(element).toMatch(/vcsKind=\{/);
    expect(element).toMatch(/checkpointTurns=\{/);
  });
});

/* ───────────────────────── B3: timeline-strip selection drives the diff content ───────────────────────── */

describe("B3 — TurnTimelineStrip click drives getCheckpointDiff and updates rendered sections", () => {
  test("clicking turn-marker-1 invokes getCheckpointDiff(chatId, 0, 1) and flips selected state", async () => {
    const apiModule = await import("../src/lib/api");
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    // Replace the client function with a spy that resolves to a
    // distinct section payload. The render should NOT include the
    // section before the click (cells are fresh) and SHOULD include
    // it after the click + re-render.
    const sentinelSections = [
      { kind: "checkpoint-range" as const, label: "0→1", diff: "diff --git a/feature.txt b/feature.txt\n+marker-one\n" },
    ];
    const spy = vi
      .spyOn(apiModule, "getCheckpointDiff")
      .mockResolvedValue({ sections: sentinelSections });

    try {
      const cells: HookCell[] = [];
      // First render — establish the cells.
      renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );

      // Re-render to read the rendered strip (the cell state is
      // populated; selectedTurn defaults to "whole").
      const { result: tree1 } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      const marker1 = byTestId(tree1, "turn-marker-1");
      expect(marker1).not.toBeNull();

      // Fire the click handler.
      const onClick = marker1!.props.onClick as () => void;
      expect(typeof onClick).toBe("function");
      onClick();

      // The API client must have been called with (chatId, 0, 1).
      expect(spy).toHaveBeenCalled();
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1]!;
      expect(lastCall[0]).toBe("c1");
      expect(lastCall[1]).toBe(0);
      expect(lastCall[2]).toBe(1);

      // Allow the promise's then-callback to flush onto setSections.
      await new Promise((r) => setTimeout(r, 0));

      // Re-render — the rendered diff sections now reflect the click
      // response, and the marker's "selected" state has flipped.
      const { result: tree2 } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      // Selected-state assertion: the marker for turn 1 carries the
      // selected styling (fontWeight 500 per TurnTimelineStrip impl).
      const refreshedMarker1 = byTestId(tree2, "turn-marker-1");
      expect(refreshedMarker1).not.toBeNull();
      const style = (refreshedMarker1!.props.style as { fontWeight?: number }) ?? {};
      expect(style.fontWeight).toBe(500);

      // The rendered diff content has changed: it contains the sentinel
      // label "0→1" from the spied client response.
      const allText = collectText(tree2);
      expect(allText).toContain("0→1");
    } finally {
      spy.mockRestore();
    }
  });

  test("clicking turn-marker-whole invokes getCheckpointDiff(chatId, 0, 'latest')", async () => {
    const apiModule = await import("../src/lib/api");
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    const spy = vi
      .spyOn(apiModule, "getCheckpointDiff")
      .mockResolvedValue({ sections: [] });

    try {
      const cells: HookCell[] = [];
      renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1],
        }),
      );
      const { result: tree } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1],
        }),
      );

      // First click turn 1, then click "whole" — verifies the
      // "whole" branch hits getCheckpointDiff(chatId, 0, "latest").
      (byTestId(tree, "turn-marker-1")!.props.onClick as () => void)();
      (byTestId(tree, "turn-marker-whole")!.props.onClick as () => void)();

      const lastCall = spy.mock.calls[spy.mock.calls.length - 1]!;
      expect(lastCall[0]).toBe("c1");
      expect(lastCall[1]).toBe(0);
      expect(lastCall[2]).toBe("latest");
    } finally {
      spy.mockRestore();
    }
  });
});
