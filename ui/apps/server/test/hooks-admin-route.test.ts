import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mountHooksAdminRoute, type HooksStatus } from "../src/routes/hooks-admin";

type Route = (req: Request, url: URL) => Response | Promise<Response>;

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "loom-hooks-admin-"));
}

async function callJson(route: Route, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const req = new Request("http://test.local/_", init);
  const res = await route(req, new URL(req.url));
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

function mount(settingsPath: string) {
  const routes: Record<string, Route> = {};
  mountHooksAdminRoute(routes, { receiverPort: 4242, settingsPath });
  return routes;
}

describe("hooks-admin route", () => {
  test("status reports not-installed when settings.json is absent", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const routes = mount(settingsPath);
    const { status, body } = await callJson(routes["/hooks/status"]);
    expect(status).toBe(200);
    const s = body as HooksStatus;
    expect(s.settingsExists).toBe(false);
    expect(s.installed).toBe(false);
    expect(s.hasMarker).toBe(false);
    expect(s.hasUserHooks).toBe(false);
    expect(s.receiverPort).toBe(4242);
    expect(s.eventsWired.length).toBe(5);
    rmSync(dir, { recursive: true });
  });

  test("status reports conflict when settings.json has user hooks but no marker", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Bash", hooks: [] }] } }),
    );
    const routes = mount(settingsPath);
    const { body } = await callJson(routes["/hooks/status"]);
    const s = body as HooksStatus;
    expect(s.hasUserHooks).toBe(true);
    expect(s.hasMarker).toBe(false);
    expect(s.installed).toBe(false);
    rmSync(dir, { recursive: true });
  });

  test("POST install writes loom entries and returns installed=true", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const routes = mount(settingsPath);
    const { status, body } = await callJson(routes["/hooks/install"], { method: "POST" });
    expect(status).toBe(200);
    const s = body as HooksStatus;
    expect(s.installed).toBe(true);
    expect(s.hasMarker).toBe(true);
    expect(s.installedAt).not.toBeNull();
    const content = readFileSync(settingsPath, "utf8");
    expect(content).toContain("127.0.0.1:4242/hooks/event");
    expect(() => JSON.parse(content)).not.toThrow();
    rmSync(dir, { recursive: true });
  });

  test("POST install rejects non-POST methods", async () => {
    const dir = tmp();
    const routes = mount(path.join(dir, "settings.json"));
    const { status } = await callJson(routes["/hooks/install"]);
    expect(status).toBe(405);
    rmSync(dir, { recursive: true });
  });

  test("POST uninstall removes loom entries and returns installed=false", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const routes = mount(settingsPath);
    await callJson(routes["/hooks/install"], { method: "POST" });
    const { body } = await callJson(routes["/hooks/uninstall"], { method: "POST" });
    const s = body as HooksStatus;
    expect(s.installed).toBe(false);
    expect(s.hasMarker).toBe(false);
    const content = readFileSync(settingsPath, "utf8");
    expect(content).not.toContain("/hooks/event");
    rmSync(dir, { recursive: true });
  });

  test("POST uninstall rejects non-POST methods", async () => {
    const dir = tmp();
    const routes = mount(path.join(dir, "settings.json"));
    const { status } = await callJson(routes["/hooks/uninstall"]);
    expect(status).toBe(405);
    rmSync(dir, { recursive: true });
  });

  test("POST reveal returns 404 when settings.json does not exist", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "absent.json");
    const routes = mount(settingsPath);
    const { status, body } = await callJson(routes["/hooks/reveal"], { method: "POST" });
    expect(status).toBe(404);
    expect(body.settingsPath).toBe(settingsPath);
    rmSync(dir, { recursive: true });
  });

  test("POST reveal returns ok when settings.json exists (spawn detached/unref'd)", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, "{}");
    const routes = mount(settingsPath);
    const { status, body } = await callJson(routes["/hooks/reveal"], { method: "POST" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  test("install -> status reflects the new installed-at timestamp", async () => {
    const dir = tmp();
    const settingsPath = path.join(dir, "settings.json");
    const routes = mount(settingsPath);
    await callJson(routes["/hooks/install"], { method: "POST" });
    const { body } = await callJson(routes["/hooks/status"]);
    const s = body as HooksStatus;
    expect(s.installedAt).not.toBeNull();
    expect(new Date(s.installedAt!).getTime()).toBeGreaterThan(0);
    rmSync(dir, { recursive: true });
  });
});
