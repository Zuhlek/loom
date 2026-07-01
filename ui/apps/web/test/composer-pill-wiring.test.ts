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

/* ───────────────────────── WorkspacePill ───────────────────────── */

async function renderWorkspace(props: Record<string, unknown>) {
  const { WorkspacePill } = await import("../src/components/chat/WorkspacePill");
  const cells: HookCell[] = [];
  const { result } = renderWith(cells, () =>
    (WorkspacePill as unknown as (p: unknown) => unknown)(props),
  );
  return byTestId(result, "workspace-pill");
}

describe("WorkspacePill — merged repo · branch · mode", () => {
  test("git + committed local renders repo, branch and 'checkout' (no pending)", async () => {
    const pill = await renderWorkspace({
      repoName: "loom",
      branch: "main",
      vcsKind: "git",
      worktreeMode: "local",
      defaultEnvMode: "worktree",
    });
    const text = collectText(pill);
    expect(text).toContain("loom");
    expect(text).toContain("main");
    expect(text).toContain("checkout");
    expect(text).not.toContain("pending");
    expect((pill!.props.style as { opacity?: number }).opacity).toBe(1);
  });

  test("git + committed worktree renders 'worktree'", async () => {
    const text = collectText(
      await renderWorkspace({
        repoName: "loom",
        branch: "loom/abc",
        vcsKind: "git",
        worktreeMode: "worktree",
        defaultEnvMode: "local",
      }),
    );
    expect(text).toContain("worktree");
    expect(text).not.toContain("pending");
  });

  test("worktreeMode=null falls back to defaultEnvMode + '(pending)'", async () => {
    const text = collectText(
      await renderWorkspace({
        repoName: "loom",
        branch: "main",
        vcsKind: "git",
        worktreeMode: null,
        defaultEnvMode: "worktree",
      }),
    );
    expect(text).toContain("worktree");
    expect(text).toContain("pending");
  });

  test("git + branch=null renders 'no branch'", async () => {
    const text = collectText(
      await renderWorkspace({
        repoName: "loom",
        branch: null,
        vcsKind: "git",
        worktreeMode: "local",
        defaultEnvMode: "local",
      }),
    );
    expect(text).toContain("no branch");
  });

  test("vcsKind='unknown' renders 'no git' + dimmed, hides branch/mode", async () => {
    const pill = await renderWorkspace({
      repoName: null,
      branch: "main",
      vcsKind: "unknown",
      worktreeMode: "local",
      defaultEnvMode: "local",
    });
    const text = collectText(pill);
    expect(text).toContain("no git");
    expect(text).not.toContain("main");
    expect(text).not.toContain("checkout");
    expect((pill!.props.style as { opacity?: number }).opacity).toBeLessThan(1);
  });
});
