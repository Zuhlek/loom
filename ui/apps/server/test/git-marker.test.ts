import { describe, test, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { probeGitMarker } from "../src/git/git-marker.ts";

const tmpDirs: string[] = [];
function track(p: string): string {
  tmpDirs.push(p);
  return p;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
  vi.restoreAllMocks();
});

describe("probeGitMarker", () => {
  test("present when a .git marker exists (dir or gitfile)", () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-marker-git-")));
    fs.mkdirSync(path.join(dir, ".git"));
    expect(probeGitMarker(dir)).toBe("present");
  });

  test("absent (ENOENT) for a non-git dir", () => {
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-marker-bare-")));
    expect(probeGitMarker(dir)).toBe("absent");
  });

  test("error (not absent) on a non-ENOENT fault, e.g. ENOTDIR / EIO", () => {
    // Statting `<file>/.git` faults with ENOTDIR — a real, deterministic
    // stand-in for the EIO a flaky mount throws. Must not be read as absent.
    const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), "loom-marker-notdir-")));
    const file = path.join(dir, "not-a-dir");
    fs.writeFileSync(file, "x");
    expect(probeGitMarker(file)).toBe("error");
  });
});
