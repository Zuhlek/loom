import { describe, test, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig } from "../src/config-loader/index.ts";
import { mountSettingsRoute } from "../src/routes/settings.ts";

function tmpFile(): string {
  return path.join(os.tmpdir(), `loom-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveConfig defaultEnvMode (T-002)", () => {
  test("absent defaultEnvMode falls back to local with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/srv" }));
    const r = resolveConfig({ configPath: p });
    expect(r.defaultEnvMode).toBe("local");
    expect(warn).toHaveBeenCalledTimes(1);
    fs.unlinkSync(p);
  });

  test("defaultEnvMode=worktree resolves without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/srv", defaultEnvMode: "worktree" }));
    const r = resolveConfig({ configPath: p });
    expect(r.defaultEnvMode).toBe("worktree");
    expect(warn).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test("defaultEnvMode=local resolves without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/srv", defaultEnvMode: "local" }));
    const r = resolveConfig({ configPath: p });
    expect(r.defaultEnvMode).toBe("local");
    expect(warn).not.toHaveBeenCalled();
    fs.unlinkSync(p);
  });

  test("malformed defaultEnvMode falls back to local with warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/srv", defaultEnvMode: "garbage" }));
    const r = resolveConfig({ configPath: p });
    expect(r.defaultEnvMode).toBe("local");
    expect(warn).toHaveBeenCalledTimes(1);
    fs.unlinkSync(p);
  });

  test("no config file → defaultEnvMode=local with warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = resolveConfig({ configPath: tmpFile() });
    expect(r.defaultEnvMode).toBe("local");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("CLI root branch carries defaultEnvMode=local (no config read)", () => {
    const r = resolveConfig({ cliRoot: "/from-cli", configPath: tmpFile() });
    expect(r.defaultEnvMode).toBe("local");
  });
});

describe("GET /settings exposes workspace.defaultEnvMode (T-002)", () => {
  test("payload contains workspace.defaultEnvMode (=worktree)", async () => {
    const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
    const config = {
      root: "/srv",
      source: "file" as const,
      worktreesRoot: null,
      configPath: "/tmp/config.json",
      defaultEnvMode: "worktree" as const,
    };
    mountSettingsRoute(routes, config);
    const fn = routes["/settings"]!;
    const res = await fn(new Request("http://localhost/settings"), new URL("http://localhost/settings"));
    const body = (await res.json()) as any;
    expect(body.workspace.defaultEnvMode).toBe("worktree");
  });

  test("payload contains workspace.defaultEnvMode (=local default)", async () => {
    const routes: Record<string, (req: Request, url: URL) => Response | Promise<Response>> = {};
    const config = {
      root: "/srv",
      source: "file" as const,
      worktreesRoot: null,
      configPath: "/tmp/config.json",
      defaultEnvMode: "local" as const,
    };
    mountSettingsRoute(routes, config);
    const fn = routes["/settings"]!;
    const res = await fn(new Request("http://localhost/settings"), new URL("http://localhost/settings"));
    const body = (await res.json()) as any;
    expect(body.workspace.defaultEnvMode).toBe("local");
  });
});
