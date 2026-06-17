import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureFolderTrusted } from "../src/process-manager/folder-trust.ts";

describe("ensureFolderTrusted", () => {
  let dir: string;
  let configPath: string;
  // Identity resolver so tests are not subject to the host's symlink layout.
  const resolvePath = (p: string) => p;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "folder-trust-"));
    configPath = join(dir, ".claude.json");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function read(): any {
    return JSON.parse(readFileSync(configPath, "utf8"));
  }

  it("creates the config file when absent and records trust", () => {
    const wrote = ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    expect(wrote).toBe(true);
    expect(read().projects["/repo/new"].hasTrustDialogAccepted).toBe(true);
  });

  it("merges into an existing config, preserving unrelated keys and projects", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        theme: "dark",
        projects: {
          "/other": { hasTrustDialogAccepted: true, allowedTools: ["Bash"] },
        },
      }),
    );
    const wrote = ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    expect(wrote).toBe(true);
    const d = read();
    // Untouched top-level + sibling project preserved.
    expect(d.theme).toBe("dark");
    expect(d.projects["/other"]).toEqual({
      hasTrustDialogAccepted: true,
      allowedTools: ["Bash"],
    });
    // New project trusted.
    expect(d.projects["/repo/new"].hasTrustDialogAccepted).toBe(true);
  });

  it("preserves an existing project entry's other fields when flipping trust", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        projects: {
          "/repo/new": { hasTrustDialogAccepted: false, allowedTools: ["Edit"] },
        },
      }),
    );
    ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    const entry = read().projects["/repo/new"];
    expect(entry.hasTrustDialogAccepted).toBe(true);
    expect(entry.allowedTools).toEqual(["Edit"]);
  });

  it("is idempotent — no write when already trusted", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ projects: { "/repo/new": { hasTrustDialogAccepted: true } } }),
    );
    const before = readFileSync(configPath, "utf8");
    const wrote = ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    expect(wrote).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("keys trust by the resolved (realpath) path", () => {
    // Simulate macOS /tmp -> /private/tmp canonicalisation.
    ensureFolderTrusted("/tmp/proj", {
      configPath,
      resolvePath: (p) => (p === "/tmp/proj" ? "/private/tmp/proj" : p),
    });
    const d = read();
    expect(d.projects["/private/tmp/proj"].hasTrustDialogAccepted).toBe(true);
    expect(d.projects["/tmp/proj"]).toBeUndefined();
  });

  it("does not clobber a malformed config", () => {
    writeFileSync(configPath, "{ not valid json");
    const wrote = ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    expect(wrote).toBe(false);
    // File left exactly as-is.
    expect(readFileSync(configPath, "utf8")).toBe("{ not valid json");
  });

  it("does not clobber a config whose top level is not an object", () => {
    writeFileSync(configPath, JSON.stringify(["array", "config"]));
    const wrote = ensureFolderTrusted("/repo/new", { configPath, resolvePath });
    expect(wrote).toBe(false);
    expect(read()).toEqual(["array", "config"]);
  });
});
