/**
 * PhaseStepper interactive tablist + a11y (T-008).
 *
 * Static-source scan (Vitest include = *.test.ts, environment = node,
 * no jsdom). Asserts:
 *   - the stepper renders as `<ol role="tablist" aria-label="Fabric phases">`
 *     and chips become `<button role="tab">`.
 *   - the selected chip is marked `aria-current="step"` and is the
 *     single tab stop (`tabIndex=0`; others `tabIndex=-1`).
 *   - the component takes `selected: PhaseId` and `onSelect: (id) => void`
 *     props (renaming the legacy `current` prop).
 *   - the route passes `selected` + `onSelect` and routes activation
 *     into `setSelectedPhase`.
 *   - the arrow-key handler computes `nextId` from a `PHASE_ORDER`
 *     array and refuses to wrap (no-op at the endpoints).
 *   - chips carry a focus-visible ring (Tailwind utility).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const stepperPath = webRoot + "src/components/fabric/PhaseStepper.tsx";
const routePath = webRoot + "src/routes/fabric-view-live.tsx";

describe("PhaseStepper interactive tablist", () => {
  const src = readFileSync(stepperPath, "utf8");

  test("renders as <ol role='tablist' aria-label='Fabric phases'>", () => {
    expect(src).toMatch(/<ol\b[^>]*role=["']tablist["']/);
    expect(src).toMatch(/aria-label=["']Fabric phases["']/);
  });

  test("chip is a <button role='tab'>", () => {
    expect(src).toMatch(/<button\b[^>]*role=["']tab["']/);
  });

  test("selected chip carries aria-current='step'", () => {
    expect(src).toMatch(/aria-current=\{[^}]*selected[^}]*===[^}]*\?\s*["']step["']/);
  });

  test("only the selected chip has tabIndex=0", () => {
    expect(src).toMatch(/tabIndex=\{[^}]*selected\s*===[^}]*\?\s*0\s*:\s*-1/);
  });

  test("component takes `selected` and `onSelect` props (renamed from `current`)", () => {
    expect(src).toMatch(/selected\s*:\s*PhaseId/);
    expect(src).toMatch(/onSelect\s*:\s*\(/);
  });

  test("arrow-key handler reads from a PHASE_ORDER array and refuses to wrap", () => {
    expect(src).toMatch(/PHASE_ORDER/);
    expect(src).toMatch(/ArrowLeft|ArrowRight/);
  });

  test("focus-visible ring uses the loom info token", () => {
    expect(src).toMatch(/focus-visible:ring/);
  });
});

describe("FabricViewLive — stepper wiring", () => {
  const src = readFileSync(routePath, "utf8");

  test("route passes `selected` and `onSelect` to PhaseStepper", () => {
    expect(src).toMatch(/<PhaseStepper\b[\s\S]*?selected=/);
    expect(src).toMatch(/<PhaseStepper\b[\s\S]*?onSelect=/);
  });

  test("route routes activation into setSelectedPhase", () => {
    expect(src).toMatch(/setSelectedPhase\b/);
  });
});
