// M4 — render-and-interact tests for the VCS-verb dim surface.
// Replaces the prior source-grep harness with assertions on rendered
// JSX output. We mount WorkspacePill and ProjectWorktreesPanel via
// the hand-rolled React harness pattern.
import { describe, expect, test, vi } from "vitest";
import { vcsVerbTooltip } from "../src/components/diff/vcs-verb-copy";

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
  function useCallback<T>(fn: T): T { return fn; }
  function useMemo<T>(factory: () => T): T { return factory(); }
  function useEffect(fn: () => void | (() => void)): void {
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
    useState, useRef, useCallback, useMemo, useEffect, createElement, Fragment,
    default: { useState, useRef, useCallback, useMemo, useEffect, createElement, Fragment },
  };
});

function renderWith<T>(cells: HookCell[], fn: () => T) {
  const f: HarnessFrame = { cells, cursor: 0, effects: [] };
  stack.push(f);
  try {
    return { result: fn(), effects: f.effects };
  } finally {
    stack.pop();
  }
}

interface JsxNode {
  type: unknown;
  props: Record<string, unknown>;
}
function isJsx(value: unknown): value is JsxNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

const componentCellMap = new WeakMap<object, HookCell[][]>();
const visitCounter = { idx: 0 };

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

function findAll(node: unknown, pred: (n: JsxNode) => boolean): JsxNode[] {
  visitCounter.idx = 0;
  const hits: JsxNode[] = [];
  visit(node, (n) => { if (pred(n)) hits.push(n); });
  return hits;
}
function findFirst(node: unknown, pred: (n: JsxNode) => boolean): JsxNode | null {
  return findAll(node, pred)[0] ?? null;
}
function byTestId(node: unknown, id: string): JsxNode | null {
  return findFirst(node, (n) => n.props["data-testid"] === id);
}

/* ───────────────────────── vcs-verb-copy: pure-function assertions ───────────────────────── */

describe("vcsVerbTooltip — copy for each verb + reason", () => {
  test("renders 'not a git repository' reason copy", () => {
    expect(vcsVerbTooltip("commit", "not-a-git-repo")).toMatch(/Commit unavailable/);
    expect(vcsVerbTooltip("commit", "not-a-git-repo")).toMatch(/not a git repository/);
  });

  test("renders 'unsupported provider' reason copy", () => {
    expect(vcsVerbTooltip("pr", "unsupported-provider")).toMatch(/Pull request unavailable/);
    expect(vcsVerbTooltip("pr", "unsupported-provider")).toMatch(/unsupported source-control/);
  });

  test("covers all 8 verb kinds (each emits a non-empty tooltip)", () => {
    const kinds = [
      "commit", "push", "pr", "switchRef", "createRef",
      "createWorktree", "removeWorktree", "checkoutChangeRequest",
    ] as const;
    for (const k of kinds) {
      const tip = vcsVerbTooltip(k, "not-a-git-repo");
      expect(tip).toMatch(/unavailable/);
      expect(tip.length).toBeGreaterThan(20);
    }
  });
});

/* ───────────────────────── WorkspacePill render assertions ───────────────────────── */

describe("WorkspacePill — dim under vcsKind='unknown'", () => {
  test("renders with opacity < 1 when vcsKind === 'unknown'", async () => {
    const { WorkspacePill } = await import("../src/components/chat/WorkspacePill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (WorkspacePill as unknown as (p: unknown) => unknown)({
        repoName: null,
        branch: "feature/x",
        vcsKind: "unknown",
        worktreeMode: "local",
        defaultEnvMode: "local",
      }),
    );
    const root = findFirst(result, (n) => n.props["data-testid"] === "workspace-pill")
      ?? findFirst(result, (n) => typeof n.props.style === "object");
    expect(root).not.toBeNull();
    const style = (root!.props.style as { opacity?: number }) ?? {};
    expect(typeof style.opacity).toBe("number");
    expect(style.opacity).toBeLessThan(1);
  });

  test("renders full opacity (=1) when vcsKind === 'git'", async () => {
    const { WorkspacePill } = await import("../src/components/chat/WorkspacePill");
    const cells: HookCell[] = [];
    const { result } = renderWith(cells, () =>
      (WorkspacePill as unknown as (p: unknown) => unknown)({
        repoName: "loom",
        branch: "main",
        vcsKind: "git",
        worktreeMode: "local",
        defaultEnvMode: "local",
      }),
    );
    const root = findFirst(result, (n) => n.props["data-testid"] === "workspace-pill")
      ?? findFirst(result, (n) => typeof n.props.style === "object");
    expect(root).not.toBeNull();
    const style = (root!.props.style as { opacity?: number }) ?? {};
    if (style.opacity !== undefined) expect(style.opacity).toBe(1);
  });
});

/* ───────────────────────── ProjectWorktreesPanel render assertions ───────────────────────── */

describe("ProjectWorktreesPanel — dim delete affordances when vcsKind='unknown'", () => {
  function makeFetchStub(worktrees: Array<{ path: string; branch: string | null; head: string | null; tenantChatIds: string[] }>) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/worktrees")) {
        return new Response(JSON.stringify({ worktrees }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
  }

  test("delete button is disabled + dimmed (opacity 0.45) when vcsKind='unknown'", async () => {
    const { ProjectWorktreesPanel } = await import(
      "../src/components/worktrees/ProjectWorktreesPanel"
    );

    const fetchStub = makeFetchStub([
      { path: "/tmp/a", branch: "main", head: "deadbeef", tenantChatIds: ["c1"] },
    ]);
    const cells: HookCell[] = [];

    // First render initialises hook cells.
    const { effects } = renderWith(cells, () =>
      (ProjectWorktreesPanel as unknown as (p: unknown) => unknown)({
        vcsKind: "unknown",
        fetchImpl: fetchStub as unknown as typeof fetch,
      }),
    );
    // Drive the useEffect that fetches the list.
    for (const fn of effects) await fn();
    // Allow the promise to resolve onto state.
    await new Promise((r) => setTimeout(r, 0));

    // Re-render: the fetched list is now in state.
    const { result: tree } = renderWith(cells, () =>
      (ProjectWorktreesPanel as unknown as (p: unknown) => unknown)({
        vcsKind: "unknown",
        fetchImpl: fetchStub as unknown as typeof fetch,
      }),
    );

    // Locate the delete button. Worktree rows live behind testid
    // `worktree-row-<path>`; the button inside is disabled and opacity-dim.
    const buttons = findAll(tree, (n) => n.type === "button");
    // At least one button should be disabled (the delete-affordance for
    // the rendered row).
    const disabledButtons = buttons.filter((b) => b.props.disabled === true);
    expect(disabledButtons.length).toBeGreaterThan(0);
    // The disabled button has the dim opacity.
    const dimmed = disabledButtons.find((b) => {
      const style = (b.props.style as { opacity?: number }) ?? {};
      return style.opacity !== undefined && style.opacity < 1;
    });
    expect(dimmed).toBeDefined();
  });

  test("delete button is enabled (not dimmed) when vcsKind='git'", async () => {
    const { ProjectWorktreesPanel } = await import(
      "../src/components/worktrees/ProjectWorktreesPanel"
    );
    const fetchStub = makeFetchStub([
      { path: "/tmp/b", branch: "main", head: "x", tenantChatIds: [] },
    ]);
    const cells: HookCell[] = [];
    const { effects } = renderWith(cells, () =>
      (ProjectWorktreesPanel as unknown as (p: unknown) => unknown)({
        vcsKind: "git",
        fetchImpl: fetchStub as unknown as typeof fetch,
      }),
    );
    for (const fn of effects) await fn();
    await new Promise((r) => setTimeout(r, 0));

    const { result: tree } = renderWith(cells, () =>
      (ProjectWorktreesPanel as unknown as (p: unknown) => unknown)({
        vcsKind: "git",
        fetchImpl: fetchStub as unknown as typeof fetch,
      }),
    );
    const buttons = findAll(tree, (n) => n.type === "button");
    // No button is disabled by the vcsKind='unknown' branch.
    const dimmed = buttons.filter((b) => {
      const style = (b.props.style as { opacity?: number }) ?? {};
      return style.opacity !== undefined && style.opacity < 1;
    });
    expect(dimmed.length).toBe(0);
  });
});
