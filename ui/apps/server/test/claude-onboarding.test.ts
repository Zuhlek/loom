import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureClaudeOnboarded } from "../src/process-manager/claude-onboarding.ts";

describe("ensureClaudeOnboarded", () => {
  let tmpDir: string;
  let configPath: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-onboarding-"));
    configPath = path.join(tmpDir, ".claude.json");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeConfig = (obj: unknown) =>
    fs.writeFileSync(configPath, JSON.stringify(obj, null, 2));
  const readConfig = () =>
    JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;

  it("is a no-op when ~/.claude.json doesn't exist", () => {
    ensureClaudeOnboarded(configPath);
    expect(fs.existsSync(configPath)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when oauthAccount is absent (let the wizard log them in)", () => {
    writeConfig({ userID: "tk" });
    ensureClaudeOnboarded(configPath);
    expect(readConfig()).toEqual({ userID: "tk" });
  });

  it("sets hasCompletedOnboarding and theme when oauthAccount is present", () => {
    writeConfig({ oauthAccount: { uuid: "abc" }, userID: "tk" });
    ensureClaudeOnboarded(configPath);
    const c = readConfig();
    expect(c.hasCompletedOnboarding).toBe(true);
    expect(c.theme).toBe("dark");
    expect(c.userID).toBe("tk");
    expect(c.oauthAccount).toEqual({ uuid: "abc" });
  });

  it("does not overwrite a user-chosen theme", () => {
    writeConfig({
      oauthAccount: { uuid: "abc" },
      theme: "light",
      hasCompletedOnboarding: false,
    });
    ensureClaudeOnboarded(configPath);
    const c = readConfig();
    expect(c.theme).toBe("light");
    expect(c.hasCompletedOnboarding).toBe(true);
  });

  it("is idempotent (no write when both flags already correct)", async () => {
    writeConfig({
      oauthAccount: { uuid: "abc" },
      hasCompletedOnboarding: true,
      theme: "dark",
    });
    const mtimeBefore = fs.statSync(configPath).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    ensureClaudeOnboarded(configPath);
    const mtimeAfter = fs.statSync(configPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it("logs a warning and bails on malformed JSON without touching the file", () => {
    fs.writeFileSync(configPath, "{ not valid json");
    ensureClaudeOnboarded(configPath);
    expect(fs.readFileSync(configPath, "utf8")).toBe("{ not valid json");
    expect(warnSpy).toHaveBeenCalled();
  });
});
