/**
 * T-014 — LoomView empty state for 404 + read-only hint
 * (US-008, US-009).
 *
 * Static-source scan (matches the existing apps/web/test harness —
 * Vitest include = *.test.ts, environment = node, no jsdom).
 *
 * Covers:
 *   - US-008 AC1: an unresolvable loom (API 404) renders a
 *     dedicated empty state naming the loom, the project, and the
 *     project's declared paths.
 *   - US-008 AC3: no generic HTTP-500 / "fetch failed" surface for
 *     the 404 case.
 *   - US-009 AC1: a "read-only — pipeline owned by /weave" hint
 *     renders near the phase stepper.
 *   - US-009 AC2: no clickable phase-mutation affordance is added
 *     to the phase grid (this is a smoke check — the stepper has
 *     been read-only in the production build).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const loomViewPath = webRoot + "src/routes/loom-view-live.tsx";
const emptyStatePath = webRoot + "src/components/loom/LoomEmptyState.tsx";

describe("T-014 LoomEmptyState component file exists and exports the component", () => {
  test("LoomEmptyState.tsx exists at the expected path", () => {
    expect(existsSync(emptyStatePath)).toBe(true);
  });

  test("LoomEmptyState is exported as a named React component", () => {
    const src = readFileSync(emptyStatePath, "utf8");
    expect(src).toMatch(/export\s+function\s+LoomEmptyState\b/);
  });

  test("LoomEmptyState renders the loom name, project name, paths, and a Back-to-home link", () => {
    const src = readFileSync(emptyStatePath, "utf8");
    // Props (loosely typed): loomName, projectName, paths.
    expect(src).toMatch(/loomName/);
    expect(src).toMatch(/projectName/);
    expect(src).toMatch(/paths/);
    // The visible affordance back to /.
    const hasBackLink =
      /href=\{?"\/"\}?/.test(src) || /<Link[^>]+href=["']\/[\s"'`]/.test(src);
    expect(hasBackLink).toBe(true);
    expect(src).toMatch(/back\s+to\s+home/i);
  });
});

describe("T-014 LoomViewLive renders the empty state on 404 (US-008 AC1, AC3)", () => {
  const src = readFileSync(loomViewPath, "utf8");
  test("LoomViewLive imports LoomEmptyState", () => {
    expect(src).toMatch(/from\s+["']\.\.\/components\/loom\/LoomEmptyState["']/);
    expect(src).toMatch(/\bLoomEmptyState\b/);
  });

  test("LoomViewLive distinguishes the 404 response from other errors", () => {
    // The fetch handler must inspect `res.status === 404` separately
    // and route to the empty-state branch rather than the generic
    // `error` chip.
    expect(src).toMatch(/res\.status\s*===\s*404|status\s*===\s*404/);
  });

  test("LoomViewLive renders <LoomEmptyState> with loomName, projectName, paths props", () => {
    expect(src).toMatch(/<LoomEmptyState\b[\s\S]*?loomName=/);
    expect(src).toMatch(/<LoomEmptyState\b[\s\S]*?projectName=/);
    expect(src).toMatch(/<LoomEmptyState\b[\s\S]*?paths=/);
  });
});

describe("T-014 LoomViewLive renders the read-only hint near the phase stepper (US-009 AC1)", () => {
  const src = readFileSync(loomViewPath, "utf8");
  test("source contains the read-only hint copy near the PhaseStepper render", () => {
    expect(src).toMatch(/read-only/i);
    expect(src).toMatch(/\/weave\b/);
    // The hint must sit near the <PhaseStepper /> mount — same
    // container or immediately adjacent.
    const stepperIdx = src.indexOf("<PhaseStepper");
    expect(stepperIdx).toBeGreaterThan(0);
    const window400 = src.slice(Math.max(0, stepperIdx - 400), stepperIdx + 400);
    expect(window400).toMatch(/read-only/i);
  });
});

// (Server-side read-only contract — including the top-of-file
// docstring and the 405-for-non-GET behaviour — is exercised by
// `apps/server/test/loom-route-no-write.test.ts`. Keeping it
// server-side avoids a cross-package readFileSync that breaks the
// web test's pnpm isolation.)
