import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanCommonParents } from "../src/discover-wizard-service/index.ts";

function tmpDir(): string {
  const p = path.join(os.tmpdir(), `nora-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

describe("scanCommonParents", () => {
  test("finds repo with .loom subdir", () => {
    const root = tmpDir();
    const repoA = path.join(root, "dev", "repo-a");
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(path.join(repoA, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repoA, ".loom", "foo"), { recursive: true });

    const out = scanCommonParents({ parents: [path.join(root, "dev")], depth: 2 });
    expect(out[0].exists).toBe(true);
    expect(out[0].matches.length).toBe(1);
    expect(out[0].matches[0].loomProjects).toContain("foo");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("non-existent parent yields exists:false", () => {
    const out = scanCommonParents({ parents: ["/this/path/does/not/exist/xyz"] });
    expect(out[0].exists).toBe(false);
    expect(out[0].matches).toEqual([]);
  });
});
