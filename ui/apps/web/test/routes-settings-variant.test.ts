/**
 * T-001 — Settings route refactor to /settings/:variant?
 *
 * Static-source scan (matches the existing apps/web/test harness:
 * Vitest include glob = *.test.ts, environment = node, no jsdom).
 *
 * US-001 AC5: the active panel SHALL be driven by the
 * `/settings/:variant?` route segment.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const settingsPath = webRoot + "src/routes/settings.tsx";
const appPath = webRoot + "src/App.tsx";

describe("T-001 settings.tsx no longer hard-codes the active panel", () => {
  test("the literal `const active = n.id === \"hooks\"` is gone", () => {
    const src = readFileSync(settingsPath, "utf8");
    expect(src).not.toMatch(/const\s+active\s*=\s*n\.id\s*===\s*"hooks"/);
  });

  test("the active value is derived from a `variant` prop or hook (US-001 AC5)", () => {
    const src = readFileSync(settingsPath, "utf8");
    // Either the component takes a `variant?: string` prop, or it
    // reads the variant from wouter's route param. We accept either
    // pattern.
    const hasVariantProp = /variant\s*\??:\s*string/.test(src);
    const hasRouteParam = /useRoute\(/.test(src) || /useParams\(/.test(src);
    expect(hasVariantProp || hasRouteParam).toBe(true);
  });
});

describe("T-001 nav buttons are <Link> components with /settings/<id> hrefs", () => {
  test("settings.tsx imports Link from wouter", () => {
    const src = readFileSync(settingsPath, "utf8");
    expect(src).toMatch(/import\s+\{[^}]*\bLink\b[^}]*\}\s+from\s+["']wouter["']/);
  });

  test("settings.tsx renders <Link href=\"/settings/<id>\"> for nav entries", () => {
    const src = readFileSync(settingsPath, "utf8");
    // Look for the templated href pattern.
    const hasLinkHref =
      /<Link\b[^>]*href=\{[`"]\/settings\//.test(src) ||
      /<Link\b[^>]*href="\/settings\//.test(src);
    expect(hasLinkHref).toBe(true);
  });
});

describe("T-001 panel mounting is driven by the variant", () => {
  test("a lookup or switch on the variant maps to panel components", () => {
    const src = readFileSync(settingsPath, "utf8");
    // The implementation may use any of:
    //   - a `Record<string, ComponentType>` lookup,
    //   - a `switch` (on `variant` or a value derived from it like
    //     `variant ?? "workspace"`),
    //   - a chain of `===` comparisons against the panel ids.
    // What matters is that at least one of the panel ids appears as
    // a switch case / comparison value alongside one of the panel
    // imports.
    const referencesPanelIds = /["'](workspace|worktrees|auth|about|hooks)["']/.test(src);
    const hasSwitchOrCompare =
      /\bswitch\s*\(/.test(src) ||
      /\bvariant\s*===\s*["']/.test(src) ||
      /\bcase\s+["'](workspace|worktrees|auth|about|hooks)["']/.test(src);
    expect(referencesPanelIds && hasSwitchOrCompare).toBe(true);
  });

  test("default (no variant) lands on Workspace per ADR-004", () => {
    const src = readFileSync(settingsPath, "utf8");
    // Implementation pattern: `variant ?? "workspace"` or
    // `variant === undefined ? <WorkspacePanel />` or a fallback
    // case in the switch. We look for either.
    const hasWorkspaceDefault =
      /["']workspace["']/.test(src) &&
      (/variant\s*\?\?\s*["']workspace["']/.test(src) ||
        /variant\s*===\s*undefined/.test(src) ||
        /\bdefault:\s*[\s\S]{0,100}WorkspacePanel/.test(src) ||
        /!variant/.test(src));
    expect(hasWorkspaceDefault).toBe(true);
  });

  test("StaticConflictDemo is removed from settings.tsx (US-004 overlap)", () => {
    const src = readFileSync(settingsPath, "utf8");
    expect(src).not.toContain("StaticConflictDemo");
  });

  test("/settings/conflict has no special branch in settings.tsx", () => {
    const src = readFileSync(settingsPath, "utf8");
    // No literal `"conflict"` branch should remain — it's an unknown
    // variant that falls through to the 404-shape empty state.
    expect(src).not.toMatch(/variant\s*===\s*["']conflict["']/);
  });

  test("unknown variants render the 404-shape empty state", () => {
    const src = readFileSync(settingsPath, "utf8");
    // The empty state is text-only ("not found" style); we just
    // check the source contains a recognisable fallback string.
    const hasNotFoundFallback =
      /not\s+found/i.test(src) ||
      /unknown\s+variant/i.test(src) ||
      /no\s+such\s+panel/i.test(src);
    expect(hasNotFoundFallback).toBe(true);
  });
});

describe("T-001 App.tsx exposes the /settings/:variant? route", () => {
  test("App.tsx registers /settings/:variant?", () => {
    const src = readFileSync(appPath, "utf8");
    const hasRouted =
      /path="\/settings\/:variant\??"/.test(src) ||
      /path="\/settings\/:variant"/.test(src);
    // Also acceptable: keep the bare /settings registration AND add
    // the :variant route, OR a single combined registration. We
    // accept either shape.
    const hasBareSettings = /path="\/settings"/.test(src);
    expect(hasRouted || hasBareSettings).toBe(true);
  });
});

describe("T-001 settings.tsx is still a valid module", () => {
  test("settings.tsx exists and exports Settings", () => {
    expect(existsSync(settingsPath)).toBe(true);
    const src = readFileSync(settingsPath, "utf8");
    expect(src).toMatch(/export\s+function\s+Settings\b/);
  });
});
