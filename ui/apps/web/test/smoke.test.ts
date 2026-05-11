import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname;

describe("apps/web frontend skeleton", () => {
  test("Vite entry index.html exists and mounts #root", () => {
    const html = readFileSync(root + "index.html", "utf8");
    expect(html).toContain('id="root"');
    expect(html).toContain("/src/main.tsx");
  });

  test("App.tsx has all expected routes wired", () => {
    const app = readFileSync(root + "src/App.tsx", "utf8");
    expect(app).toContain('path="/discover"');
    expect(app).toContain('path="/empty"');
    expect(app).toContain('path="/spawn"');
    // Live chat route by id; the legacy mock-variant route is mounted at
    // /chat-mock/:variant (still string-matches "chat/:variant").
    expect(app).toContain("/chat/:id");
    expect(app).toContain("/chat-mock/:variant");
    expect(app).toContain("/loom/:phase");
    expect(app).toContain("/settings/:variant");
  });

  test("Sidebar and AppSidebarLayout exist", () => {
    expect(existsSync(root + "src/components/Sidebar.tsx")).toBe(true);
    expect(existsSync(root + "src/components/layout/AppSidebarLayout.tsx")).toBe(true);
  });

  test("All 16 mockup pages have a React route", () => {
    const expected = [
      "src/routes/discover-wizard.tsx",
      "src/routes/empty-home.tsx",
      "src/routes/spawn-chat-dialog.tsx",
      "src/routes/chat.tsx",
      "src/routes/loom-view.tsx",
      "src/routes/settings.tsx",
      "src/routes/multi-tab-same-cwd.tsx",
      "src/routes/multi-path-project.tsx",
      "src/routes/handoff-fork-menu.tsx",
    ];
    for (const f of expected) {
      expect(existsSync(root + f)).toBe(true);
    }
  });

  test("Diff panel and loom components are in place", () => {
    expect(existsSync(root + "src/components/diff/DiffPanel.tsx")).toBe(true);
    expect(existsSync(root + "src/components/loom/PhaseStepper.tsx")).toBe(true);
    expect(existsSync(root + "src/components/loom/KanbanView.tsx")).toBe(true);
    expect(existsSync(root + "src/components/loom/EventsTail.tsx")).toBe(true);
  });

  test("TasksPanel exists and exposes header + status icons for all three states", () => {
    const file = root + "src/components/TasksPanel.tsx";
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, "utf8");
    // The header reads "TASKS" (mirrors t3code's PlanSidebar rendering).
    expect(src).toContain("TASKS");
    expect(src).toContain("STEPS");
    // All three task statuses are handled.
    expect(src).toContain('"completed"');
    expect(src).toContain('"inProgress"');
    expect(src).toContain('"pending"');
    // Collapsed-mode test id present.
    expect(src).toContain('data-testid="tasks-panel-collapsed"');
    expect(src).toContain('data-testid="tasks-panel"');
  });

  test("LiveChatRoute wires the tasks-update WS frame and Tasks toggle", () => {
    const src = readFileSync(root + "src/routes/live-chat.tsx", "utf8");
    expect(src).toContain("tasks-update");
    expect(src).toContain("TasksPanel");
    expect(src).toContain('data-testid="tasks-toggle"');
  });

  test("NewProjectDialog component exists", () => {
    expect(existsSync(root + "src/components/NewProjectDialog.tsx")).toBe(true);
  });

  test("LiveSidebar renders the per-project new-chat affordance", () => {
    // Static-string check rather than a full React render — keeps the
    // smoke test infrastructure-free. The data-testid is the contract.
    const src = readFileSync(root + "src/components/LiveSidebar.tsx", "utf8");
    expect(src).toContain('data-testid="new-chat-in-project"');
    expect(src).toContain('data-testid="delete-chat"');
    // Bug 1 fix: chat-row + flex children carry min-w-0 so the row doesn't
    // overflow past the X-button visible edge.
    expect(src).toContain("ml-3 min-w-0 rounded-md");
    // Project group wrapper carries min-w-0 for the same reason.
    expect(src).toContain('className="mb-1 min-w-0"');
  });

  test("LiveHome wires the project-first CTA", () => {
    const src = readFileSync(root + "src/routes/live-home.tsx", "utf8");
    expect(src).toContain("Create your first project");
    expect(src).toContain("NewProjectDialog");
  });

  test("SpawnChatModalLive accepts a locked project prop", () => {
    const src = readFileSync(root + "src/routes/spawn-chat-dialog-live.tsx", "utf8");
    // The new contract uses projectId on the body, not projectName.
    expect(src).toContain("projectId: project?.id");
    // Locked-project banner copy.
    expect(src).toContain("Project: {project.name}");
  });
});
