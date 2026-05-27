/*
 * ModeIndicatorPill — composer bottom-left read-only mode indicator.
 *
 * Static-source assertions per project convention (vitest in node
 * runtime — no jsdom; see ui/vitest.config.ts). The component file
 * must exist, export `ModeIndicatorPill`, accept the
 * `ModeIndicatorPillProps` prop shape, render the three copy variants
 * exactly per US-001 AC1-AC3, and NOT bind an onClick handler.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const pillPath = webRoot + "src/components/chat/ModeIndicatorPill.tsx";

describe("ModeIndicatorPill — composer mode indicator", () => {
  test("file exists", () => {
    expect(existsSync(pillPath)).toBe(true);
  });

  test("exports a ModeIndicatorPill component", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+function\s+ModeIndicatorPill\b/);
  });

  test("exports a ModeIndicatorPillProps type with worktreeMode + defaultEnvMode", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+ModeIndicatorPillProps/);
    expect(src).toMatch(/worktreeMode/);
    expect(src).toMatch(/defaultEnvMode/);
  });

  test("renders 'current checkout' copy for worktree_mode='local'", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/current checkout/);
  });

  test("renders 'new worktree' copy for worktree_mode='worktree'", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/new worktree/);
  });

  test("renders 'pending first-send' qualifier when worktree_mode is null", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).toMatch(/pending first-send/);
  });

  test("does not bind an onClick handler (read-only)", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).not.toMatch(/\bonClick\b/);
  });

  test("renders a non-button element (no role='button')", () => {
    const src = readFileSync(pillPath, "utf8");
    expect(src).not.toMatch(/role=["']button["']/);
  });
});
