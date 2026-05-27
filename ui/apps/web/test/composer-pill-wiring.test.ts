// M4 — render-and-interact tests for the composer pills.
// Replaces the prior source-grep harness. Mounts the pills directly
// (their integration into ChatComposer is exercised by the existing
// composer integration tests) and asserts on rendered output.
import { describe, expect, test, vi } from "vitest";

/* ───────────────────────── React harness ───────────────────────── */

interface HookCell { kind: "state" | "ref"; value: unknown; }
interface HarnessFrame { cells: HookCell[]; cursor: number; effects: Array<() => void | (() => void)>; }
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
      cell.value = typeof next === "function" ? (next as (p: T) => T)(cell.value as T) : next;
    };
    return [cell.value as T, setter];
  }
  function useRef<T>(initial: T): { current: T } {
    const f = frame();
    const idx = f.cursor++;
    if (idx >= f.cells.length) f.cells.push({ kind: "ref", value: { current: initial } });
    return f.cells[idx]!.value as { current: T };
  }
  function noopHook<T>(fn: T): T { return fn; }
  function useEffect(): void { /* no-op */ }
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
    useCallback: noopHook,
    useMemo: <T,>(factory: () => T) => factory(),
    useEffect,
    createElement,
    Fragment,
    default: { useState, useRef, useCallback: noopHook, useMemo: <T,>(f: () => T) => f(), useEffect, createElement, Fragment },
  };
});

function renderWith<T>(cells: HookCell[], fn: () => T) {
  const f: HarnessFrame = { cells, cursor: 0, effects: [] };
  stack.push(f);
  try { return { result: fn(), effects: f.effects }; } finally { stack.pop(); }
}

interface JsxNode { type: unknown; props: Record<string, unknown>; }
function isJsx(value: unknown): value is JsxNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}
function visit(node: unknown, visitor: (n: JsxNode) => void): void {
  if (node === null || node === undefined || node === false) return;
  if (Array.isArray(node)) { for (const c of node) visit(c, visitor); return; }
  if (!isJsx(node)) return;
  visitor(node);
  if (node.props.children !== undefined) visit(node.props.children, visitor);
}
function findFirst(node: unknown, pred: (n: JsxNode) => boolean): JsxNode | null {
  let hit: JsxNode | null = null;
  visit(node, (n) => { if (!hit && pred(n)) hit = n; });
  return hit;
}
function byTestId(node: unknown, id: string): JsxNode | null {
  return findFirst(node, (n) => n.props["data-testid"] === id);
}
function collectText(node: unknown): string {
  let out = "";
  visit(node, (n) => { void n; });
  const recurse = (n: unknown): void => {
    if (n === null || n === undefined || n === false) return;
    if (typeof n === "string" || typeof n === "number") { out += String(n); return; }
    if (Array.isArray(n)) { for (const c of n) recurse(c); return; }
    if (isJsx(n)) recurse(n.props.children);
  };
  recurse(node);
  return out;
}

/* ───────────────────────── ModeIndicatorPill ───────────────────────── */

describe("ModeIndicatorPill — pending vs committed copy", () => {
  test("worktree_mode === null + defaultEnvMode='worktree' renders 'new worktree (pending first-send)'", async () => {
    const { ModeIndicatorPill } = await import("../src/components/chat/ModeIndicatorPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (ModeIndicatorPill as unknown as (p: unknown) => unknown)({
        worktreeMode: null,
        defaultEnvMode: "worktree",
      }),
    );
    const pill = byTestId(result, "mode-indicator-pill");
    expect(pill).not.toBeNull();
    expect(collectText(pill)).toContain("new worktree");
    expect(collectText(pill)).toContain("pending first-send");
  });

  test("worktree_mode === null + defaultEnvMode='local' renders 'current checkout (pending first-send)'", async () => {
    const { ModeIndicatorPill } = await import("../src/components/chat/ModeIndicatorPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (ModeIndicatorPill as unknown as (p: unknown) => unknown)({
        worktreeMode: null,
        defaultEnvMode: "local",
      }),
    );
    expect(collectText(byTestId(result, "mode-indicator-pill"))).toContain("current checkout");
    expect(collectText(byTestId(result, "mode-indicator-pill"))).toContain("pending first-send");
  });

  test("committed worktree_mode='worktree' renders 'new worktree' (no pending qualifier)", async () => {
    const { ModeIndicatorPill } = await import("../src/components/chat/ModeIndicatorPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (ModeIndicatorPill as unknown as (p: unknown) => unknown)({
        worktreeMode: "worktree",
        defaultEnvMode: "local",
      }),
    );
    const text = collectText(byTestId(result, "mode-indicator-pill"));
    expect(text).toContain("new worktree");
    expect(text).not.toContain("pending first-send");
  });

  test("committed worktree_mode='local' renders 'current checkout'", async () => {
    const { ModeIndicatorPill } = await import("../src/components/chat/ModeIndicatorPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (ModeIndicatorPill as unknown as (p: unknown) => unknown)({
        worktreeMode: "local",
        defaultEnvMode: "worktree",
      }),
    );
    const text = collectText(byTestId(result, "mode-indicator-pill"));
    expect(text).toContain("current checkout");
    expect(text).not.toContain("pending first-send");
  });
});

/* ───────────────────────── AttachedRefPill ───────────────────────── */

describe("AttachedRefPill — branch text + dim under unknown vcsKind", () => {
  test("vcsKind='git' + branch='feat/x' renders the branch name", async () => {
    const { AttachedRefPill } = await import("../src/components/chat/AttachedRefPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (AttachedRefPill as unknown as (p: unknown) => unknown)({
        branch: "feat/x",
        vcsKind: "git",
      }),
    );
    const pill = byTestId(result, "attached-ref-pill");
    expect(pill).not.toBeNull();
    expect(collectText(pill)).toBe("feat/x");
    const style = (pill!.props.style as { opacity?: number }) ?? {};
    expect(style.opacity).toBe(1);
  });

  test("vcsKind='unknown' renders 'no git' + dimmed opacity", async () => {
    const { AttachedRefPill } = await import("../src/components/chat/AttachedRefPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (AttachedRefPill as unknown as (p: unknown) => unknown)({
        branch: null,
        vcsKind: "unknown",
      }),
    );
    const pill = byTestId(result, "attached-ref-pill");
    expect(collectText(pill)).toContain("no git");
    const style = (pill!.props.style as { opacity?: number }) ?? {};
    expect(style.opacity).toBeLessThan(1);
  });

  test("vcsKind='git' + branch=null renders 'no branch'", async () => {
    const { AttachedRefPill } = await import("../src/components/chat/AttachedRefPill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (AttachedRefPill as unknown as (p: unknown) => unknown)({
        branch: null,
        vcsKind: "git",
      }),
    );
    expect(collectText(byTestId(result, "attached-ref-pill"))).toBe("no branch");
  });
});
