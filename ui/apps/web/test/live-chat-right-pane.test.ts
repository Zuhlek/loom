/**
 * T-007 — `tasksOpen` → `rightPane` migration (US-004, US-005).
 *
 * Runtime is `node`; no jsdom. The asserting style is static-source
 * over `routes/live-chat.tsx`, matching the precedent in
 * `composer-controls.test.ts`, `proposed-plan-card.test.ts`, and
 * `diff-panel-controlled-scope.test.ts` (T-002).
 *
 * The contract being verified:
 *   - The discriminated-union state `rightPane: "tasks" | "diff" |
 *     null` replaces the legacy boolean `tasksOpen`. No `tasksOpen`
 *     references survive (per user MEMORY: no `tasksOpen_old` shim,
 *     no dual-state fallback).
 *   - Two toggle handlers `onToggleTasks` / `onToggleDiff` are
 *     defined with the contract from `design.md` (functional setter
 *     toggling between the discriminator and `null`).
 *   - The topbar exposes both a Tasks button (always present) and a
 *     Diff button (conditional on `chat?.worktree_mode ===
 *     "worktree"`), wired to the two toggle handlers.
 *   - The `rightDrawer` slot branches on `rightPane`: `"tasks"` →
 *     `<TasksPanel ... />`, `"diff" && worktree_mode === "worktree"`
 *     → `<DiffPanelContainer ... />`, otherwise `undefined`.
 *   - The auto-open-tasks `tasksAutoOpenedRef` guard checks
 *     `rightPane === null` so tasks arriving while diff is open do
 *     NOT clobber the user's right-pane selection.
 *   - The `DiffPanelContainer` stub component exists at the path
 *     `src/components/diff/DiffPanelContainer.tsx` and exports the
 *     prop interface T-008 will consume.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/live-chat.tsx";
const containerPath = webRoot + "src/components/diff/DiffPanelContainer.tsx";

describe("T-007 rightPane state migration", () => {
  test("declares useState<\"tasks\" | \"diff\" | null>(null) for rightPane", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /const\s+\[\s*rightPane\s*,\s*setRightPane\s*\]\s*=\s*useState<\s*["']tasks["']\s*\|\s*["']diff["']\s*\|\s*null\s*>\(\s*null\s*\)/,
    );
  });

  test("does not retain any reference to the legacy tasksOpen identifier", () => {
    const src = readFileSync(routePath, "utf8");
    // Per user MEMORY: no `tasksOpen_old` shim, no dual-state
    // fallback. The boolean must be fully removed; both the state
    // variable and its setter should have zero occurrences in the
    // file (the contract sets a hard zero, not a soft "no usage").
    expect(src).not.toMatch(/\btasksOpen\b/);
    expect(src).not.toMatch(/\bsetTasksOpen\b/);
  });
});

describe("T-007 toggle handlers", () => {
  test("defines onToggleTasks that flips between \"tasks\" and null via functional setter", () => {
    const src = readFileSync(routePath, "utf8");
    // The handler body is the verbatim form from design.md. We
    // tolerate optional `const` / `let` and whitespace, but the
    // setRightPane functional-setter shape must be present.
    expect(src).toMatch(
      /onToggleTasks\s*=\s*\(\s*\)\s*=>\s*\n?\s*setRightPane\(\s*\(?\s*p\s*\)?\s*=>\s*\(\s*p\s*===\s*["']tasks["']\s*\?\s*null\s*:\s*["']tasks["']\s*\)\s*\)/,
    );
  });

  test("defines onToggleDiff that flips between \"diff\" and null via functional setter", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /onToggleDiff\s*=\s*\(\s*\)\s*=>\s*\n?\s*setRightPane\(\s*\(?\s*p\s*\)?\s*=>\s*\(\s*p\s*===\s*["']diff["']\s*\?\s*null\s*:\s*["']diff["']\s*\)\s*\)/,
    );
  });
});

describe("T-007 topbar buttons", () => {
  test("Tasks button calls onToggleTasks", () => {
    const src = readFileSync(routePath, "utf8");
    // The Tasks button stays in the topbar and is rewired to the
    // new handler. We assert the handler appears on a button (the
    // `data-testid="tasks-toggle"` marker is preserved as the
    // stable selector for downstream e2e tests).
    expect(src).toMatch(/data-testid="tasks-toggle"/);
    expect(src).toMatch(/onClick=\{\s*onToggleTasks\s*\}/);
  });

  test("Tasks button active style keys on rightPane === \"tasks\"", () => {
    const src = readFileSync(routePath, "utf8");
    // Per design.md US-005 AC3, active-state styling reflects
    // `rightPane`. Either `clsx(... rightPane === "tasks" ...)` or a
    // straight ternary is acceptable — we assert the predicate
    // appears in the topbar JSX.
    expect(src).toMatch(/rightPane\s*===\s*["']tasks["']/);
  });

  test("Diff button is conditionally rendered for worktree_mode === \"worktree\"", () => {
    const src = readFileSync(routePath, "utf8");
    // The Diff button only renders when the chat is in worktree
    // mode. Local-mode chats never see the button (US-004 AC2).
    // Accept either a `chat?.worktree_mode === "worktree" &&`
    // short-circuit guard or an explicit `{ chat?.worktree_mode ===
    // "worktree" ? <button .../> : null }` ternary.
    expect(src).toMatch(/chat\?\.worktree_mode\s*===\s*["']worktree["']/);
  });

  test("Diff button calls onToggleDiff and uses a data-testid for selection", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/data-testid="diff-toggle"/);
    expect(src).toMatch(/onClick=\{\s*onToggleDiff\s*\}/);
  });

  test("Diff button active style keys on rightPane === \"diff\"", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/rightPane\s*===\s*["']diff["']/);
  });
});

describe("T-007 rightDrawer slot wiring", () => {
  test("rightDrawer branches on rightPane === \"tasks\" → <TasksPanel ... />", () => {
    const src = readFileSync(routePath, "utf8");
    // Match the verbatim contract from design.md: ternary chain
    // anchored on `rightPane === "tasks"` followed by `<TasksPanel`.
    expect(src).toMatch(
      /rightPane\s*===\s*["']tasks["']\s*\?\s*\(\s*<TasksPanel/,
    );
  });

  test("rightDrawer renders <DiffPanelContainer> when rightPane === \"diff\" AND worktree_mode === \"worktree\"", () => {
    const src = readFileSync(routePath, "utf8");
    // The second branch of the ternary is `rightPane === "diff" &&
    // chat?.worktree_mode === "worktree"` followed by
    // `<DiffPanelContainer`.
    expect(src).toMatch(
      /rightPane\s*===\s*["']diff["']\s*&&\s*chat\?\.worktree_mode\s*===\s*["']worktree["']/,
    );
    expect(src).toMatch(/<DiffPanelContainer\b/);
  });

  test("DiffPanelContainer is imported from the components/diff barrel path", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*DiffPanelContainer\s*\}\s*from\s*["']\.\.\/components\/diff\/DiffPanelContainer["']/,
    );
  });

  test("DiffPanelContainer receives worktreePath from chat.worktree_path and chatId from chat.id", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/worktreePath=\{\s*chat\.worktree_path\s*\}/);
    expect(src).toMatch(/chatId=\{\s*chat\.id\s*\}/);
  });
});

describe("T-007 auto-open-tasks ref gating", () => {
  test("auto-open guard checks rightPane === null before firing", () => {
    const src = readFileSync(routePath, "utf8");
    // Per US-005 AC5: tasks arriving while `rightPane === "diff"`
    // must NOT clobber the user's selection. The ref still gates
    // duplicate auto-opens (so it stays in the condition) but the
    // new precondition is that the drawer is currently collapsed.
    // The auto-open lives inside the ws-onmessage closure which
    // captures state at attach time, so the implementation may
    // read through a ref mirror (`rightPaneRef.current === null`)
    // or use a functional-setter check (`(current) => current ===
    // null`). Either form is acceptable.
    expect(src).toMatch(
      /!tasksAutoOpenedRef\.current[\s\S]{0,200}(?:rightPane(?:Ref\.current)?|current)\s*===\s*null/,
    );
  });

  test("auto-open flips rightPane to \"tasks\" via setRightPane", () => {
    const src = readFileSync(routePath, "utf8");
    // The body of the auto-open block sets the right pane to
    // "tasks". We don't anchor on the surrounding `if (...)` so
    // either `setRightPane("tasks")` form works.
    expect(src).toMatch(/setRightPane\(\s*["']tasks["']\s*\)/);
  });

  test("on chatId change, the right pane is reset to null", () => {
    const src = readFileSync(routePath, "utf8");
    // The reset effect (lines ~344-352 pre-migration) collapses
    // every per-chat piece of state. The drawer collapse must move
    // from `setTasksOpen(false)` to `setRightPane(null)`.
    expect(src).toMatch(/setRightPane\(\s*null\s*\)/);
  });
});

describe("T-007 TasksPanel wiring", () => {
  test("TasksPanel.open derives from rightPane === \"tasks\"", () => {
    const src = readFileSync(routePath, "utf8");
    // The right-drawer JSX uses `open={rightPane === "tasks"}` on
    // the TasksPanel mount (controlled-component contract).
    expect(src).toMatch(/open=\{\s*rightPane\s*===\s*["']tasks["']\s*\}/);
  });

  test("TasksPanel.onToggle is the onToggleTasks handler", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/onToggle=\{\s*onToggleTasks\s*\}/);
  });
});

describe("T-007 DiffPanelContainer stub", () => {
  test("file exists at src/components/diff/DiffPanelContainer.tsx", () => {
    expect(existsSync(containerPath)).toBe(true);
  });

  test("exports DiffPanelContainerProps with worktreePath: string | null and chatId: string", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+DiffPanelContainerProps\b/);
    expect(src).toMatch(/worktreePath\s*:\s*string\s*\|\s*null/);
    expect(src).toMatch(/chatId\s*:\s*string/);
  });

  test("exports a DiffPanelContainer function component accepting DiffPanelContainerProps", () => {
    const src = readFileSync(containerPath, "utf8");
    expect(src).toMatch(
      /export\s+function\s+DiffPanelContainer\s*\([^)]*:\s*DiffPanelContainerProps\s*\)/,
    );
  });

  // The T-007 stub-marker assertion has been retired: T-008 replaces
  // the stub body with the full container implementation, so the
  // `data-stub="diff-panel-container"` marker is gone by design. The
  // marker's purpose was to anchor the T-007 red-phase assertion;
  // T-008's own test suite (`diff-panel-container.test.ts`) replaces
  // it with assertions on the live container's import + state shape.
});
