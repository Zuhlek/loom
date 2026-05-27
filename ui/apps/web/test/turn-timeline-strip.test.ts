/*
 * TurnTimelineStrip — horizontal marker strip for per-turn diff scope.
 *
 * Static-source assertions on the component file shape.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const stripPath = webRoot + "src/components/diff/TurnTimelineStrip.tsx";

describe("TurnTimelineStrip — diff panel header strip", () => {
  test("file exists", () => {
    expect(existsSync(stripPath)).toBe(true);
  });

  test("exports TurnTimelineStrip + TurnTimelineStripProps + TurnMarker", () => {
    const src = readFileSync(stripPath, "utf8");
    expect(src).toMatch(/export\s+function\s+TurnTimelineStrip\b/);
    expect(src).toMatch(/export\s+interface\s+TurnTimelineStripProps/);
    expect(src).toMatch(/export\s+interface\s+TurnMarker/);
  });

  test("props include markers + selected + onSelect + emptyState", () => {
    const src = readFileSync(stripPath, "utf8");
    expect(src).toMatch(/markers:\s*TurnMarker\[\]/);
    expect(src).toMatch(/selected:\s*number\s*\|\s*"whole"/);
    expect(src).toMatch(/onSelect\s*\(\s*sel:\s*number\s*\|\s*"whole"/);
    expect(src).toMatch(/emptyState\?:\s*\{[^}]*badgeCopy/);
  });

  test("badge copy supports 'no per-turn history' and 'non-git project'", () => {
    const src = readFileSync(stripPath, "utf8");
    expect(src).toMatch(/no per-turn history/);
    expect(src).toMatch(/non-git project/);
  });

  test("renders one element per marker (markers.map)", () => {
    const src = readFileSync(stripPath, "utf8");
    expect(src).toMatch(/markers\.map/);
  });

  test("has overflow-x style for horizontal scroll on overflow", () => {
    const src = readFileSync(stripPath, "utf8");
    expect(src).toMatch(/overflow-x|overflowX/);
  });

  test("visual distinction between 'whole' and a selected marker", () => {
    const src = readFileSync(stripPath, "utf8");
    // The "whole" branch and the marker-selected branch must apply
    // different styling.
    expect(src).toMatch(/selected\s*===\s*"whole"|selected === "whole"/);
  });
});
