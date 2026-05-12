/**
 * T-012 — App shell mounts useHealthPoll + BackendOfflineBanner once
 * (US-005 AC1, AC2). Static-source scan style — matches the project's
 * node-only Vitest harness.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const webRoot = new URL("../", import.meta.url).pathname;
const appPath = webRoot + "src/App.tsx";

function read(): string {
  return readFileSync(appPath, "utf8");
}

describe("T-012 App.tsx mounts the banner + hook (US-005 AC1, AC2)", () => {
  test("imports useHealthPoll from lib/useHealthPoll", () => {
    const src = read();
    expect(/import\s+\{[^}]*useHealthPoll[^}]*\}\s+from\s+["']\.\/lib\/useHealthPoll["']/.test(src)).toBe(true);
  });

  test("imports BackendOfflineBanner from components/BackendOfflineBanner", () => {
    const src = read();
    expect(
      /import\s+\{[^}]*BackendOfflineBanner[^}]*\}\s+from\s+["']\.\/components\/BackendOfflineBanner["']/.test(src),
    ).toBe(true);
  });

  test("invokes useHealthPoll() exactly once in the App body", () => {
    const src = read();
    const matches = src.match(/useHealthPoll\(/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  test("renders <BackendOfflineBanner ...> exactly once in App.tsx", () => {
    const src = read();
    const matches = src.match(/<BackendOfflineBanner\b/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  test("the banner element passes offline + offlineSince + onRetry props sourced from the hook", () => {
    const src = read();
    // Crude but effective on static JSX.
    expect(/<BackendOfflineBanner[^>]*offline=/.test(src)).toBe(true);
    expect(/<BackendOfflineBanner[^>]*offlineSince=/.test(src)).toBe(true);
    expect(/<BackendOfflineBanner[^>]*onRetry=/.test(src)).toBe(true);
  });
});

describe("T-012 LiveSidebar no longer ships the per-component offline pill (US-005 AC1)", () => {
  test("the literal 'backend offline' copy is removed from the sidebar footer", () => {
    const src = readFileSync(webRoot + "src/components/LiveSidebar.tsx", "utf8");
    expect(src).not.toMatch(/backend offline/);
  });
});

describe("T-012 routes refetch on BackendOnlineEvent (US-005 AC2)", () => {
  test("sidebar-state.tsx listens for BackendOnlineEvent and refetches", () => {
    const src = readFileSync(webRoot + "src/lib/sidebar-state.tsx", "utf8");
    expect(/BACKEND_ONLINE_EVENT|"loom:backend-online"/.test(src)).toBe(true);
    expect(/addEventListener\(/.test(src)).toBe(true);
  });

  test("loom-view-live.tsx listens for BackendOnlineEvent and refetches", () => {
    const src = readFileSync(webRoot + "src/routes/loom-view-live.tsx", "utf8");
    expect(/BACKEND_ONLINE_EVENT|"loom:backend-online"/.test(src)).toBe(true);
    expect(/addEventListener\(/.test(src)).toBe(true);
  });
});
