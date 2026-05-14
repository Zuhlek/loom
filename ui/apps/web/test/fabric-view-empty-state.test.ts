/**
 * FabricView empty state for 404 + disclaimer removal.
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom).
 *
 * Covers:
 *   - An unresolvable fabric (API 404) renders a dedicated empty state
 *     naming the fabric, the project, and the project's declared paths.
 *   - No generic HTTP-500 / "fetch failed" surface for the 404 case.
 *   - The legacy "read-only — pipeline owned by /weave" disclaimer and
 *     its `data-testid="fabric-readonly-hint"` element are removed.
 *   - The locked empty-state copy (`FABRIC_EMPTY_COPY`) is imported
 *     from `fabric-phase-map.ts` and rendered in the route.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const fabricViewPath = webRoot + "src/routes/fabric-view-live.tsx";
const emptyStatePath = webRoot + "src/components/fabric/FabricEmptyState.tsx";
const phaseMapPath = webRoot + "src/components/fabric/fabric-phase-map.ts";

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

describe("FabricViewLive no longer carries the disclaimer paragraph", () => {
  const src = readFileSync(fabricViewPath, "utf8");

  test("source does NOT contain the literal disclaimer copy", () => {
    expect(src).not.toMatch(/read-only\s+—\s+pipeline owned by \/weave/);
  });

  test("source does NOT contain the legacy fabric-readonly-hint testid", () => {
    expect(src).not.toMatch(/fabric-readonly-hint/);
  });
});

describe("Locked empty-state copy lives in fabric-phase-map.ts", () => {
  test("fabric-phase-map.ts exports FABRIC_EMPTY_COPY with the exact locked string", () => {
    expect(existsSync(phaseMapPath)).toBe(true);
    const src = readFileSync(phaseMapPath, "utf8");
    expect(src).toMatch(/export const FABRIC_EMPTY_COPY/);
    expect(src).toMatch(/No artifacts yet — pipeline is still initializing\./);
  });
});
