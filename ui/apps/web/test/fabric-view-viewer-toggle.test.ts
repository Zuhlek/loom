/**
 * File-selection semantics in the two-pane layout.
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - clicking a file row toggles `selectedFile`; re-clicking the same
 *     row clears it so the pane falls back to the phase artifact.
 *   - picking a phase from the stepper clears any sticky `selectedFile`.
 *   - the active-file highlight in the tree is driven by
 *     `selectedFile ?? PHASE_TO_FILE[selectedPhase]`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("FabricViewLive — file-selection semantics", () => {
  const src = readFileSync(routePath, "utf8");

  test("file-row handler toggles off when re-clicking the same path", () => {
    expect(src).toMatch(
      /setSelectedFile\s*\(\s*\(\s*prev\s*\)\s*=>\s*\(?\s*prev\s*===\s*[A-Za-z_]+\s*\?\s*null\s*:/,
    );
  });

  test("phase-select handler clears selectedFile", () => {
    expect(src).toMatch(/handlePhaseSelect/);
    const start = src.indexOf("const handlePhaseSelect");
    const end = src.indexOf("};", start);
    const slice = src.slice(start, end);
    expect(slice).toMatch(/setSelectedFile\(null\)/);
  });

  test("tree selectedPath falls back to phase file when no file picked", () => {
    expect(src).toMatch(/selectedFile\s*\?\?\s*phaseFile/);
  });

  test("handleFileSelect goes through the route", () => {
    expect(src).toMatch(/handleFileSelect\b/);
    expect(src).toMatch(/<FileTreeDrawer\b[\s\S]*?onSelect=\{handleFileSelect\}/);
  });
});
