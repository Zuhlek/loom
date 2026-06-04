// Right-pane state migration tests — `tasksOpen` → `rightPane` union.
//
// Build-2 over-anchored on the `chat?.worktree_mode === "worktree"`
// gates; those gates have been removed (B2 in Review-2). The render
// + interaction assertions for the DiffPanelContainer live in
// `diff-panel-container-mount.test.ts`. This file retains the
// structural anchors that survive: union shape, toggle handlers,
// auto-open guards.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/live-chat.tsx";
const containerPath = webRoot + "src/components/diff/DiffPanelContainer.tsx";

describe("rightPane state migration", () => {
  test("declares useState<...> for rightPane with the tasks + diff arms + null collapsed", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /const\s+\[\s*rightPane\s*,\s*setRightPane\s*\]\s*=\s*useState<\s*["']tasks["']\s*\|\s*["']diff["'][^>]*\|\s*null\s*>\(\s*null\s*\)/,
    );
  });

  test("no `tasksOpen` legacy boolean survives", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).not.toMatch(/\btasksOpen\b/);
    expect(src).not.toMatch(/\bsetTasksOpen\b/);
  });
});

describe("toggle handlers", () => {
  test("onToggleTasks flips between \"tasks\" and null via functional setter", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /onToggleTasks\s*=\s*\(\s*\)\s*=>\s*\n?\s*setRightPane\(\s*\(?\s*p\s*\)?\s*=>\s*\(\s*p\s*===\s*["']tasks["']\s*\?\s*null\s*:\s*["']tasks["']\s*\)\s*\)/,
    );
  });

  test("onToggleDiff flips between \"diff\" and null via functional setter", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /onToggleDiff\s*=\s*\(\s*\)\s*=>\s*\n?\s*setRightPane\(\s*\(?\s*p\s*\)?\s*=>\s*\(\s*p\s*===\s*["']diff["']\s*\?\s*null\s*:\s*["']diff["']\s*\)\s*\)/,
    );
  });
});

describe("topbar buttons", () => {
  test("Tasks button calls onToggleTasks", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/data-testid="tasks-toggle"/);
    expect(src).toMatch(/onClick=\{\s*onToggleTasks\s*\}/);
  });

  test("Tasks button active style keys on rightPane === \"tasks\"", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/rightPane\s*===\s*["']tasks["']/);
  });

  test("Diff button is unconditionally rendered (no worktree_mode gate)", () => {
    const src = readFileSync(routePath, "utf8");
    // The Diff button block carries `data-testid="diff-toggle"`.
    // Build-2 wrapped it in `{chat?.worktree_mode === "worktree" && ...}`;
    // that wrapper is gone per US-005 AC9 / Q16 (panel mounts
    // unconditionally). The runtime mount assertions live in
    // `diff-panel-container-mount.test.ts`; here we anchor the source
    // condition.
    const idx = src.indexOf('data-testid="diff-toggle"');
    expect(idx).toBeGreaterThan(-1);
    // Inspect ~300 chars above the button declaration; the conditional
    // `chat?.worktree_mode === "worktree" && (` must be gone.
    const window = src.slice(Math.max(0, idx - 300), idx);
    expect(window).not.toMatch(
      /worktree_mode\s*===\s*["']worktree["']\s*&&/,
    );
  });

  test("Diff button calls onToggleDiff", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/data-testid="diff-toggle"/);
    expect(src).toMatch(/onClick=\{\s*onToggleDiff\s*\}/);
  });

  test("Diff button active style keys on rightPane === \"diff\"", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/rightPane\s*===\s*["']diff["']/);
  });
});

describe("rightDrawer slot wiring", () => {
  test("rightDrawer branches on rightPane === \"tasks\" → <TasksPanel ... />", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /rightPane\s*===\s*["']tasks["']\s*\?\s*\(\s*<TasksPanel/,
    );
  });

  test("rightDrawer renders <DiffPanelContainer> when rightPane === \"diff\" (no worktree_mode gate)", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/<DiffPanelContainer\b/);
    // The conditional that opens the DiffPanelContainer branch must
    // be `rightPane === "diff" && chat` (truthy on any mode).
    const idx = src.indexOf("<DiffPanelContainer");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, idx - 300), idx);
    expect(window).not.toMatch(/worktree_mode\s*===\s*["']worktree["']/);
  });

  test("DiffPanelContainer is imported from the components/diff barrel path", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /import\s*\{\s*DiffPanelContainer\s*\}\s*from\s*["']\.\.\/components\/diff\/DiffPanelContainer["']/,
    );
  });

  test("DiffPanelContainer receives worktreePath, chatId, vcsKind, refreshSignal", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/worktreePath=\{\s*chat\.worktree_path\s*\}/);
    expect(src).toMatch(/chatId=\{\s*chat\.id\s*\}/);
    expect(src).toMatch(/vcsKind=\{/);
    expect(src).toMatch(/refreshSignal=\{/);
  });
});

describe("auto-open-tasks ref gating", () => {
  test("auto-open guard checks rightPane === null before firing", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(
      /!tasksAutoOpenedRef\.current[\s\S]{0,200}(?:rightPane(?:Ref\.current)?|current)\s*===\s*null/,
    );
  });

  test("auto-open flips rightPane to \"tasks\" via setRightPane", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/setRightPane\(\s*["']tasks["']\s*\)/);
  });

  test("on chatId change, the right pane is reset to null", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/setRightPane\(\s*null\s*\)/);
  });
});

describe("TasksPanel wiring", () => {
  test("TasksPanel.open derives from rightPane === \"tasks\"", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/open=\{\s*rightPane\s*===\s*["']tasks["']\s*\}/);
  });

  test("TasksPanel.onToggle is the onToggleTasks handler", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toMatch(/onToggle=\{\s*onToggleTasks\s*\}/);
  });
});

describe("DiffPanelContainer props", () => {
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
});
