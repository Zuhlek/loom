/**
 * T-002 — Workspace / Worktrees / Auth / About settings panels (US-001).
 *
 * Static-source scan (matches the existing apps/web/test harness:
 * Vitest include = *.test.ts, runtime = node, no jsdom).
 *
 * Covers US-001 AC1..AC4 — each panel sources its data from the
 * declared GET /settings slice (or /api/health for About) and
 * renders the labelled fields named in the spec.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const panelDir = webRoot + "src/routes/settings";
const apiPath = webRoot + "src/lib/api.ts";

interface PanelSpec {
  id: string;
  file: string;
  exportName: string;
  /** Labelled fields the panel must render. */
  fields: RegExp[];
  /** Slice or fetch source the panel must reference. */
  source: RegExp;
}

const PANELS: PanelSpec[] = [
  {
    id: "workspace",
    file: panelDir + "/WorkspacePanel.tsx",
    exportName: "WorkspacePanel",
    fields: [/root/i, /source/i],
    source: /getSettings\(\)|ApiSettings/,
  },
  {
    id: "worktrees",
    file: panelDir + "/WorktreesPanel.tsx",
    exportName: "WorktreesPanel",
    fields: [/root/i],
    source: /getSettings\(\)|ApiSettings/,
  },
  {
    id: "auth",
    file: panelDir + "/AuthPanel.tsx",
    exportName: "AuthPanel",
    fields: [/logged\s?in|loggedIn/i, /api.?key|apiKey/i],
    source: /getSettings\(\)|ApiSettings/,
  },
  {
    id: "about",
    file: panelDir + "/AboutPanel.tsx",
    exportName: "AboutPanel",
    fields: [/version/i],
    // About is the one panel that fetches /api/health directly.
    source: /getHealth\(\)|\/health|ApiHealth/,
  },
];

describe("T-002 lib/api.ts exposes getSettings and the ApiSettings shape", () => {
  test("api.ts exports getSettings()", () => {
    const src = readFileSync(apiPath, "utf8");
    expect(src).toMatch(/export\s+async\s+function\s+getSettings\b/);
  });

  test("api.ts exports the ApiSettings interface with workspace, worktrees, auth slices", () => {
    const src = readFileSync(apiPath, "utf8");
    expect(src).toMatch(/export\s+interface\s+ApiSettings\b/);
    // The interface body declares all three slices.
    expect(src).toMatch(/workspace\s*:\s*\{[^}]*root[^}]*source[^}]*\}/);
    expect(src).toMatch(/worktrees\s*:\s*\{[^}]*root[^}]*\}/);
    expect(src).toMatch(/auth\s*:\s*\{[^}]*loggedIn[^}]*\}/);
  });

  test("api.ts exports getHealth() for the About panel", () => {
    const src = readFileSync(apiPath, "utf8");
    expect(src).toMatch(/export\s+async\s+function\s+getHealth\b/);
  });
});

describe("T-002 panel components exist and source the right data slice (US-001 AC1-AC4)", () => {
  for (const p of PANELS) {
    test(`${p.exportName} file exists`, () => {
      expect(existsSync(p.file)).toBe(true);
    });

    test(`${p.exportName} is exported by name`, () => {
      const src = readFileSync(p.file, "utf8");
      const re = new RegExp(`export\\s+function\\s+${p.exportName}\\b`);
      expect(src).toMatch(re);
    });

    test(`${p.exportName} references its data source (${p.source})`, () => {
      const src = readFileSync(p.file, "utf8");
      expect(src).toMatch(p.source);
    });

    for (const field of p.fields) {
      test(`${p.exportName} renders the ${field} field`, () => {
        const src = readFileSync(p.file, "utf8");
        expect(src).toMatch(field);
      });
    }
  }
});

describe("T-002 settings.tsx routes the variant to the correct panel", () => {
  test("settings.tsx imports all four new panel components", () => {
    const src = readFileSync(webRoot + "src/routes/settings.tsx", "utf8");
    for (const p of PANELS) {
      const re = new RegExp(`\\b${p.exportName}\\b`);
      expect(src).toMatch(re);
    }
  });
});
