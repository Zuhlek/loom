// Follow-up 3 — DiffPanelContainer scope toggle and selectedTurn are
// synced. The two selectors were independent in Build-3 (clicking a
// marker did not update `scope`; toggling `scope` did not clear
// `selectedTurn`). The fix makes `scope` a derived value of
// `selectedTurn` so the panel has a single canonical "what am I
// showing" state.
//
// Tests use the same hand-rolled React harness as
// `diff-panel-container-mount.test.ts` (render + click + re-render).
import { describe, expect, test, vi } from "vitest";

/* ───────────────────────── React harness (copied verbatim) ───────────────────────── */

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

const componentCellMap = new WeakMap<object, HookCell[][]>();

function visit(node: unknown, visitor: (n: JsxNode) => void): void {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, visitor);
    return;
  }
  if (!isJsx(node)) return;
  visitor(node);
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

function findFirst(node: unknown, pred: (n: JsxNode) => boolean): JsxNode | null {
  visitCounter.idx = 0;
  const all: JsxNode[] = [];
  visit(node, (n) => {
    if (pred(n)) all.push(n);
  });
  return all[0] ?? null;
}

function byTestId(node: unknown, id: string): JsxNode | null {
  return findFirst(node, (n) => n.props["data-testid"] === id);
}

/* ───────────────────────── F3 tests ───────────────────────── */

describe("Follow-up 3 — DiffPanelContainer scope ↔ selectedTurn sync", () => {
  test("clicking turn-marker-1 selects that turn AND the explicit 'whole-chat' toggle shows as deselected", async () => {
    const apiModule = await import("../src/lib/api");
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    const checkpointSpy = vi
      .spyOn(apiModule, "getCheckpointDiff")
      .mockResolvedValue({
        sections: [
          {
            kind: "checkpoint-range" as const,
            label: "0→1",
            diff: "diff --git a/x b/x\n+marker-one\n",
          },
        ],
      });
    const diffSpy = vi.spyOn(apiModule, "getDiff").mockResolvedValue({ sections: [] });

    try {
      const cells: HookCell[] = [];
      // Establish hook state.
      renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      // First useful render — read the initial pre-click tree.
      const { result: pre } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      // Pre-click: the explicit "Whole conversation" toggle shows
      // as SELECTED (default scope=whole derived from
      // selectedTurn==="whole").
      const wholeBtnPre = byTestId(pre, "diff-scope-whole");
      expect(wholeBtnPre).not.toBeNull();
      const wholeStylePre = (wholeBtnPre!.props.style as { color?: string; background?: string }) ?? {};
      // The selected branch sets color: var(--foreground); the
      // unselected branch sets color: var(--muted-foreground).
      expect(wholeStylePre.color).toBe("var(--foreground)");

      // Click turn marker 1.
      const marker1 = byTestId(pre, "turn-marker-1");
      expect(marker1).not.toBeNull();
      (marker1!.props.onClick as () => void)();

      // The marker click handler dispatches getCheckpointDiff for the
      // turn-1 range — verifies the spy was called with (chatId, 0, 1).
      expect(checkpointSpy).toHaveBeenCalled();
      const lastCall = checkpointSpy.mock.calls[checkpointSpy.mock.calls.length - 1]!;
      expect(lastCall[0]).toBe("c1");
      expect(lastCall[1]).toBe(0);
      expect(lastCall[2]).toBe(1);

      // Re-render to read post-click state.
      const { result: post } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: null,
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );

      // Post-click: the turn-1 marker shows SELECTED styling.
      const marker1Post = byTestId(post, "turn-marker-1");
      const m1Style = (marker1Post!.props.style as { fontWeight?: number }) ?? {};
      expect(m1Style.fontWeight).toBe(500);

      // Post-click: the explicit "Whole conversation" toggle now
      // shows DESELECTED (because derived scope flipped to "per-turn"
      // when selectedTurn moved off "whole").
      const wholeBtnPost = byTestId(post, "diff-scope-whole");
      const wholeStylePost = (wholeBtnPost!.props.style as { color?: string }) ?? {};
      expect(wholeStylePost.color).toBe("var(--muted-foreground)");

      // The per-turn pill should now be the "selected" side of the
      // toggle.
      const perTurnPost = byTestId(post, "diff-scope-per-turn");
      const perTurnStylePost = (perTurnPost!.props.style as { color?: string }) ?? {};
      expect(perTurnStylePost.color).toBe("var(--foreground)");
    } finally {
      checkpointSpy.mockRestore();
      diffSpy.mockRestore();
    }
  });

  test("clicking the 'Whole conversation' toggle clears selectedTurn and re-fetches whole-chat diff (getDiff, not getCheckpointDiff)", async () => {
    const apiModule = await import("../src/lib/api");
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    const checkpointSpy = vi
      .spyOn(apiModule, "getCheckpointDiff")
      .mockResolvedValue({ sections: [] });
    const diffSpy = vi
      .spyOn(apiModule, "getDiff")
      .mockResolvedValue({ sections: [] });

    try {
      const cells: HookCell[] = [];
      renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: "/tmp/wt",
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      const { result: tree } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: "/tmp/wt",
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );

      // Select turn 2 first.
      (byTestId(tree, "turn-marker-2")!.props.onClick as () => void)();

      // Re-render and verify marker-2 is selected.
      const { result: afterTurnClick } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: "/tmp/wt",
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      const m2Style = (byTestId(afterTurnClick, "turn-marker-2")!.props.style as { fontWeight?: number }) ?? {};
      expect(m2Style.fontWeight).toBe(500);

      // Clear the spies — we want to assert what happens after the
      // explicit "Whole conversation" click without polluting from
      // the prior turn-click.
      checkpointSpy.mockClear();
      diffSpy.mockClear();

      // Click the "Whole conversation" pill in the scope toggle.
      const wholeToggle = byTestId(afterTurnClick, "diff-scope-whole");
      expect(wholeToggle).not.toBeNull();
      (wholeToggle!.props.onClick as () => void)();

      // The whole toggle must have triggered getDiff (whole-chat
      // working-tree path), NOT getCheckpointDiff.
      expect(diffSpy).toHaveBeenCalled();
      expect(checkpointSpy).not.toHaveBeenCalled();
      const lastDiffArgs = diffSpy.mock.calls[diffSpy.mock.calls.length - 1]!;
      expect(lastDiffArgs[0]).toBe("/tmp/wt");
      expect((lastDiffArgs[1] as { mode: string }).mode).toBe("whole");

      // Re-render: selectedTurn cleared back to "whole"; marker-2 no
      // longer renders with selected styling.
      const { result: afterWhole } = renderWith(cells, () =>
        (DiffPanelContainer as unknown as (p: unknown) => unknown)({
          worktreePath: "/tmp/wt",
          chatId: "c1",
          vcsKind: "git",
          checkpointTurns: [0, 1, 2],
        }),
      );
      const m2StyleCleared = (byTestId(afterWhole, "turn-marker-2")!.props.style as { fontWeight?: number }) ?? {};
      expect(m2StyleCleared.fontWeight).toBe(400);

      // And the whole-toggle pill is back to selected styling.
      const wholeStyleCleared = (byTestId(afterWhole, "diff-scope-whole")!.props.style as { color?: string }) ?? {};
      expect(wholeStyleCleared.color).toBe("var(--foreground)");
    } finally {
      checkpointSpy.mockRestore();
      diffSpy.mockRestore();
    }
  });

  test("anti-regression: with no marker ever selected, the panel default behaviour is whole-chat (selectedTurn === 'whole', derived scope === 'whole')", async () => {
    const { DiffPanelContainer } = await import("../src/components/diff/DiffPanelContainer");

    const cells: HookCell[] = [];
    const { result: tree } = renderWith(cells, () =>
      (DiffPanelContainer as unknown as (p: unknown) => unknown)({
        worktreePath: "/tmp/wt",
        chatId: "c1",
        vcsKind: "git",
        checkpointTurns: [0, 1, 2],
      }),
    );

    // The "Whole conversation" pill is the selected side of the
    // scope toggle at mount (derived from selectedTurn === "whole").
    const wholeBtn = byTestId(tree, "diff-scope-whole");
    expect(wholeBtn).not.toBeNull();
    const wholeStyle = (wholeBtn!.props.style as { color?: string }) ?? {};
    expect(wholeStyle.color).toBe("var(--foreground)");

    // The strip "whole" pill is selected too (single source of truth).
    const stripWhole = byTestId(tree, "turn-marker-whole");
    expect(stripWhole).not.toBeNull();
    const stripWholeStyle = (stripWhole!.props.style as { fontWeight?: number }) ?? {};
    expect(stripWholeStyle.fontWeight).toBe(500);

    // No turn-marker is highlighted.
    const marker0Style = (byTestId(tree, "turn-marker-0")!.props.style as { fontWeight?: number }) ?? {};
    const marker1Style = (byTestId(tree, "turn-marker-1")!.props.style as { fontWeight?: number }) ?? {};
    const marker2Style = (byTestId(tree, "turn-marker-2")!.props.style as { fontWeight?: number }) ?? {};
    expect(marker0Style.fontWeight).toBe(400);
    expect(marker1Style.fontWeight).toBe(400);
    expect(marker2Style.fontWeight).toBe(400);
  });
});
