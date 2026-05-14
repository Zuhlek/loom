import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("apps/web frontend skeleton", () => {
  test("Vite entry index.html exists and mounts #root", () => {
    const html = readFileSync(root + "index.html", "utf8");
    expect(html).toContain('id="root"');
    expect(html).toContain("/src/main.tsx");
  });

  test("App.tsx has all expected routes wired", () => {
    const app = readFileSync(root + "src/App.tsx", "utf8");
    expect(app).toContain('path="/discover"');
    expect(app).toContain("/chat/:id");
    expect(app).toContain("/fabric/:projectId/:fabricName");
    // T-001: settings route is /settings/:variant? — the active panel
    // is driven by the route segment rather than a hard-coded
    // constant. The bare `/settings` segment falls through to the
    // Workspace panel via the optional :variant param.
    expect(app).toContain('path="/settings/:variant');
  });

  test("Production route files exist", () => {
    const expected = [
      "src/routes/discover-wizard.tsx",
      "src/routes/live-home.tsx",
      "src/routes/live-chat.tsx",
      "src/routes/fabric-view-live.tsx",
      "src/routes/spawn-chat-dialog-live.tsx",
      "src/routes/settings.tsx",
    ];
    for (const f of expected) {
      expect(existsSync(root + f)).toBe(true);
    }
  });

  test("Diff panel and fabric components are in place", () => {
    expect(existsSync(root + "src/components/diff/DiffPanel.tsx")).toBe(true);
    expect(existsSync(root + "src/components/fabric/PhaseStepper.tsx")).toBe(true);
    expect(existsSync(root + "src/components/fabric/KanbanView.tsx")).toBe(true);
  });

  test("TasksPanel exists and exposes header + status icons for all three states", () => {
    const file = root + "src/components/TasksPanel.tsx";
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, "utf8");
    // The header reads "TASKS" (mirrors t3code's PlanSidebar rendering).
    expect(src).toContain("TASKS");
    // All three task statuses are handled.
    expect(src).toContain('"completed"');
    expect(src).toContain('"inProgress"');
    expect(src).toContain('"pending"');
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
