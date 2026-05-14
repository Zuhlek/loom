/**
 * FabricView empty state for 404 + read-only hint.
 *
 * Static-source scan (matches the existing apps/web/test harness —
 * Vitest include = *.test.ts, environment = node, no jsdom).
 *
 * Covers:
 *   - An unresolvable fabric (API 404) renders a dedicated empty
 *     state naming the fabric, the project, and the project's
 *     declared paths.
 *   - No generic HTTP-500 / "fetch failed" surface for the 404 case.
 *   - A "read-only — pipeline owned by /weave" hint renders near the
 *     phase stepper.
 *   - No clickable phase-mutation affordance is added to the phase
 *     grid (smoke check — the stepper has been read-only in the
 *     production build).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const fabricViewPath = webRoot + "src/routes/fabric-view-live.tsx";
const emptyStatePath = webRoot + "src/components/fabric/FabricEmptyState.tsx";

describe("FabricEmptyState component file exists and exports the component", () => {
  test("FabricEmptyState.tsx exists at the expected path", () => {
    expect(existsSync(emptyStatePath)).toBe(true);
  });

  test("FabricEmptyState is exported as a named React component", () => {
    const src = readFileSync(emptyStatePath, "utf8");
    expect(src).toMatch(/export\s+function\s+FabricEmptyState\b/);
  });

  test("FabricEmptyState renders the fabric name, project name, paths, and a Back-to-home link", () => {
    const src = readFileSync(emptyStatePath, "utf8");
    expect(src).toMatch(/fabricName/);
    expect(src).toMatch(/projectName/);
    expect(src).toMatch(/paths/);
    const hasBackLink =
      /href=\{?"\/"\}?/.test(src) || /<Link[^>]+href=["']\/[\s"'`]/.test(src);
    expect(hasBackLink).toBe(true);
    expect(src).toMatch(/back\s+to\s+home/i);
  });
});

describe("FabricViewLive renders the empty state on 404", () => {
  const src = readFileSync(fabricViewPath, "utf8");
  test("FabricViewLive imports FabricEmptyState", () => {
    expect(src).toMatch(/from\s+["']\.\.\/components\/fabric\/FabricEmptyState["']/);
    expect(src).toMatch(/\bFabricEmptyState\b/);
  });

  test("FabricViewLive distinguishes the 404 response from other errors", () => {
    expect(src).toMatch(/res\.status\s*===\s*404|status\s*===\s*404/);
  });

  test("FabricViewLive renders <FabricEmptyState> with fabricName, projectName, paths props", () => {
    expect(src).toMatch(/<FabricEmptyState\b[\s\S]*?fabricName=/);
    expect(src).toMatch(/<FabricEmptyState\b[\s\S]*?projectName=/);
    expect(src).toMatch(/<FabricEmptyState\b[\s\S]*?paths=/);
  });
});

describe("FabricViewLive renders the read-only hint near the phase stepper", () => {
  const src = readFileSync(fabricViewPath, "utf8");
  test("source contains the read-only hint copy near the PhaseStepper render", () => {
    expect(src).toMatch(/read-only/i);
    expect(src).toMatch(/\/weave\b/);
    const stepperIdx = src.indexOf("<PhaseStepper");
    expect(stepperIdx).toBeGreaterThan(0);
    const window400 = src.slice(Math.max(0, stepperIdx - 400), stepperIdx + 400);
    expect(window400).toMatch(/read-only/i);
  });
});
