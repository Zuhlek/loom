/**
 * T-012 — ComposerAtFileMenu (presentational, US-008 AC3 + US-009 AC4).
 *
 * The component mirrors ComposerSlashMenu's structure: role="listbox"
 * outer container, role="option" buttons, onMouseDown preventDefault
 * to keep textarea focus, parent-driven selection / hover / select
 * callbacks. Renders basename in mono + dirname in muted text.
 *
 * Test style: static-source contract checks against the new component
 * source (precedent in `tool-result-media.test.ts`,
 * `working-chip.test.ts`). The vitest config is node-only; render-
 * level RTL assertions are not available in this repo.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const menuPath = webRoot + "src/components/chat/ComposerAtFileMenu.tsx";

function readMenuSource(): string {
  return readFileSync(menuPath, "utf8");
}

describe("T-012 ComposerAtFileMenu — presentational contract (US-008/009)", () => {
  test("ComposerAtFileMenu.tsx exists at the documented path", () => {
    expect(existsSync(menuPath)).toBe(true);
  });

  test("exports the ComposerAtFileMenu function/component and its Props", () => {
    const src = readMenuSource();
    expect(src).toMatch(/export\s+(function|const)\s+ComposerAtFileMenu\b/);
    expect(src).toMatch(/export\s+interface\s+ComposerAtFileMenuProps\b/);
  });

  test("Props declare items / selectedIndex / onHover / onSelect / loading", () => {
    const src = readMenuSource();
    expect(src).toMatch(/items\s*:\s*string\[\]/);
    expect(src).toMatch(/selectedIndex\s*:\s*number/);
    expect(src).toMatch(/onHover\s*:\s*\(\s*[a-zA-Z_$][\w$]*\s*:\s*number\s*\)/);
    expect(src).toMatch(/onSelect\s*:\s*\(\s*[a-zA-Z_$][\w$]*\s*:\s*string\s*\)/);
    expect(src).toMatch(/loading\?\s*:\s*boolean/);
  });

  test("outer container is role='listbox' with the data-testid hook", () => {
    const src = readMenuSource();
    expect(src).toMatch(/role=["']listbox["']/);
    expect(src).toMatch(/data-testid=["']composer-atfile-menu["']/);
  });

  test("renders role='option' rows with aria-selected wired to selectedIndex", () => {
    const src = readMenuSource();
    expect(src).toMatch(/role=["']option["']/);
    expect(src).toMatch(/aria-selected=\{[^}]*selectedIndex[^}]*\}/);
  });

  test("rows declare onMouseDown preventDefault (keep textarea focus)", () => {
    const src = readMenuSource();
    // Mirror of slash-menu: per-row button uses onMouseDown e.preventDefault().
    expect(src).toMatch(/onMouseDown=\{[^}]*preventDefault\(\)/);
  });

  test("rows wire onMouseEnter to onHover and onClick to onSelect", () => {
    const src = readMenuSource();
    expect(src).toMatch(/onMouseEnter=\{[^}]*onHover\b/);
    expect(src).toMatch(/onClick=\{[^}]*onSelect\b/);
  });

  test("basename renders in a mono span and dirname in a muted span", () => {
    const src = readMenuSource();
    // Mono utility class on the basename span; muted-foreground style
    // for the dirname span. Accept either Tailwind `font-mono` or an
    // equivalent CSS variable token.
    expect(src).toMatch(/font-mono/);
    expect(src).toMatch(/muted-foreground|muted/);
    // The component splits the path via `/`.
    expect(src).toMatch(/split\(["']\/["']\)/);
  });

  test("renders a query-aware empty-state row when items is empty and not loading", () => {
    const src = readMenuSource();
    // The frame renders whenever the parent mounts the component
    // (trigger-active). The empty branch is query-aware: a "Type to
    // search files" / "No matching files" row keyed off the query,
    // surfaced through the dedicated empty-state test-id.
    expect(src).toMatch(/items\.length\s*===?\s*0/);
    expect(src).toMatch(/data-testid=["']composer-atfile-menu-empty["']/);
    expect(src).toMatch(/Type to search files|No matching files/);
  });

  test("renders a loading state row when loading && items.length === 0", () => {
    const src = readMenuSource();
    // A user-visible "Searching" / "Loading" string is rendered inside
    // the container when the loading branch fires.
    expect(src).toMatch(/Searching|Loading/);
  });
});
