/**
 * T-010 — Dev / mockup route + component deletion (US-004).
 *
 * Two test concerns folded into one .test.ts file to match the
 * project's web test harness (Vitest include = *.test.ts, runtime =
 * node, static-source scan style).
 *
 *   1. The six dev route registrations are absent from App.tsx:
 *      /index, /chat-mock/:variant, /multi-tab, /multi-path, /handoff,
 *      /settings/conflict.
 *   2. The five (six counting `components/Sidebar.tsx`) backing
 *      component files are absent from disk.
 *   3. No source file under `ui/apps/web/src/` imports any of the
 *      deleted component identifiers.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const webRoot = new URL("../", import.meta.url).pathname;
const appPath = webRoot + "src/App.tsx";
const srcRoot = webRoot + "src";

const DELETED_ROUTE_PATHS = [
  "/index",
  "/chat-mock/:variant",
  "/multi-tab",
  "/multi-path",
  "/handoff",
  "/settings/conflict",
] as const;

const DELETED_FILES = [
  "src/routes/index-page.tsx",
  "src/routes/multi-tab-same-cwd.tsx",
  "src/routes/multi-path-project.tsx",
  "src/routes/handoff-fork-menu.tsx",
  "src/components/Sidebar.tsx",
  // The mock `routes/chat.tsx` was the variant that backed
  // /chat-mock/:variant; the live chat route lives at
  // routes/live-chat.tsx — these are distinct files. The mock
  // version must be gone; live-chat.tsx must remain.
] as const;

const DELETED_IDENTIFIERS = [
  "IndexPage",
  "MultiTabSameCwd",
  "MultiPathProject",
  "HandoffForkMenu",
  "StaticConflictDemo",
] as const;

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walkSources(p, out);
    else if (s.isFile() && (p.endsWith(".tsx") || p.endsWith(".ts"))) out.push(p);
  }
  return out;
}

describe("T-010 dev/mockup route registrations are absent from App.tsx (US-004 AC1)", () => {
  const app = readFileSync(appPath, "utf8");
  for (const routePath of DELETED_ROUTE_PATHS) {
    test(`App.tsx does not register ${routePath}`, () => {
      // Match the literal path inside path="..." prop. We use a strict
      // anchor on `path="<route>"` to avoid false positives on
      // surrounding URL fragments.
      const re = new RegExp(`path="${routePath.replace(/[\/]/g, "\\/")}"`);
      expect(app).not.toMatch(re);
    });
  }

  test("App.tsx still renders the production routes", () => {
    expect(app).toContain('path="/"');
    expect(app).toContain('path="/discover"');
    expect(app).toContain("/chat/:id");
    expect(app).toContain("/fabric/:projectId/:fabricName");
    // T-001: settings route is now /settings/:variant? — the bare
    // `/settings` segment falls through to Workspace per ADR-004
    // via the optional variant param.
    expect(app).toMatch(/path="\/settings\/:variant/);
  });

  test("App.tsx still has the catch-all 'Page not found' fallback", () => {
    expect(app).toContain("Page not found");
  });
});

describe("T-010 deleted backing component files are absent from disk (US-004 AC2)", () => {
  for (const file of DELETED_FILES) {
    test(`${file} no longer exists`, () => {
      expect(existsSync(webRoot + file)).toBe(false);
    });
  }
});

describe("T-010 no source file imports the deleted identifiers (US-004 AC3)", () => {
  const sources = walkSources(srcRoot);
  for (const ident of DELETED_IDENTIFIERS) {
    test(`no .ts/.tsx source under src/ references ${ident}`, () => {
      const offenders: string[] = [];
      const wordRe = new RegExp(`\\b${ident}\\b`);
      for (const src of sources) {
        const text = readFileSync(src, "utf8");
        if (wordRe.test(text)) offenders.push(src.slice(srcRoot.length + 1));
      }
      expect(offenders).toEqual([]);
    });
  }
});
