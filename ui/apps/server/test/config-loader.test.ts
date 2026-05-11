import { describe, test, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfig, writeConfig } from "../src/config-loader/index.ts";

function tmpFile(): string {
  return path.join(os.tmpdir(), `loom-config-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe("resolveConfig", () => {
  test("CLI flag wins even when config.json exists", () => {
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/from-file" }));
    const r = resolveConfig({ cliRoot: "/from-cli", configPath: p });
    expect(r.root).toBe("/from-cli");
    expect(r.source).toBe("cli");
    fs.unlinkSync(p);
  });

  test("config.json fallback when no CLI", () => {
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ root: "/srv" }));
    const r = resolveConfig({ configPath: p });
    expect(r.root).toBe("/srv");
    expect(r.source).toBe("file");
    fs.unlinkSync(p);
  });

  test("no source returns none", () => {
    const r = resolveConfig({ configPath: tmpFile() });
    expect(r.root).toBe(null);
    expect(r.source).toBe("none");
  });

  test("malformed config.json yields none + warning, no crash", () => {
    const p = tmpFile();
    fs.writeFileSync(p, "{not valid json");
    const r = resolveConfig({ configPath: p });
    expect(r.source).toBe("none");
    fs.unlinkSync(p);
  });

  test("writeConfig round-trip", () => {
    const p = tmpFile();
    writeConfig(p, { root: "/abc", worktreesRoot: "/wt" });
    const r = resolveConfig({ configPath: p });
    expect(r.root).toBe("/abc");
    expect(r.worktreesRoot).toBe("/wt");
    fs.unlinkSync(p);
  });
});
