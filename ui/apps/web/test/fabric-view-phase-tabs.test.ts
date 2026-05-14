/**
 * Phase-tab wiring (T-009).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the route imports the locked PHASE_TO_FILE / PHASE_EMPTY_COPY /
 *     FABRIC_EMPTY_COPY constants from `fabric-phase-map.ts` rather
 *     than inlining the strings.
 *   - `selectedPhase` initialises from `phaseFromPipeline(data.pipeline)`
 *     once `data` resolves (sticky init guarded by `selectedPhase ===
 *     null && data`).
 *   - subsequent polls do not overwrite `selectedPhase` (no
 *     `setSelectedPhase(phaseFromPipeline(...))` runs from the
 *     fetchData success path itself).
 *   - the main-pane render dispatches via `phaseFile` /
 *     `phaseFileContent`, falling back to `PHASE_EMPTY_COPY[selectedPhase]`
 *     when content is missing.
 *   - `fabricTreeEmpty` short-circuits to `FABRIC_EMPTY_COPY`.
 *   - the stepper `states` map (`phaseStates`) continues to be
 *     recomputed from `data.pipeline.current.phase` on every render.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricViewLive — phase-tab wiring", () => {
  const src = readFileSync(routePath, "utf8");

  test("route imports the locked constants from fabric-phase-map", () => {
    expect(src).toMatch(/from\s+["']\.\.\/components\/fabric\/fabric-phase-map["']/);
    expect(src).toMatch(/PHASE_TO_FILE/);
    expect(src).toMatch(/PHASE_EMPTY_COPY/);
    expect(src).toMatch(/FABRIC_EMPTY_COPY/);
  });

  test("selectedPhase init guard fires only while it is still null and data is present", () => {
    expect(src).toMatch(
      /if\s*\(\s*selectedPhase\s*===\s*null\s*&&\s*data\s*\)\s*\{\s*setSelectedPhase\(phaseFromPipeline\(data\.pipeline\)\)/,
    );
  });

  test("fetchData success path does not overwrite selectedPhase", () => {
    const fetchDataStart = src.indexOf("const fetchData =");
    const fetchDataEnd = src.indexOf("useEffect", fetchDataStart);
    expect(fetchDataStart).toBeGreaterThan(-1);
    const fetchDataSlice = src.slice(fetchDataStart, fetchDataEnd);
    expect(fetchDataSlice).not.toMatch(/setSelectedPhase\(/);
  });

  test("phaseFile lookup goes through PHASE_TO_FILE", () => {
    expect(src).toMatch(/PHASE_TO_FILE\s*\[/);
  });

  test("phase-empty branch renders PHASE_EMPTY_COPY[selectedPhase]", () => {
    expect(src).toMatch(/PHASE_EMPTY_COPY\s*\[/);
  });

  test("tree-empty branch renders FABRIC_EMPTY_COPY", () => {
    expect(src).toMatch(/\{\s*FABRIC_EMPTY_COPY\s*\}/);
  });

  test("phaseStates is recomputed via useMemo keyed on pipeline current.phase", () => {
    expect(src).toMatch(/useMemo\([\s\S]*?phaseStatesFor/);
    expect(src).toMatch(/data\?\.pipeline\?\.current\?\.phase/);
  });

  test("phaseFromPipeline helper survives the refactor", () => {
    expect(src).toMatch(/function\s+phaseFromPipeline\b/);
  });

  test("phaseFromPipeline defaults to 'spec' when current.phase is unparseable", () => {
    const sliceStart = src.indexOf("function phaseFromPipeline");
    const sliceEnd = src.indexOf("function phaseStatesFor", sliceStart);
    const helper = src.slice(sliceStart, sliceEnd);
    expect(helper).toMatch(/return\s+["']spec["']/);
  });
});
