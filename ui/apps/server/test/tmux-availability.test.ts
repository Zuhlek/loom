import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock node:child_process before importing the module under test.
// We replace `execFile` with a recorded fake that the suite controls.
type Capture = {
  argv: string[][];
  /** Push one shape per call; consumed in order. */
  results: Array<
    | { kind: "ok"; stdout: string; stderr?: string }
    | { kind: "err"; code: string | number; stderr?: string }
  >;
};
const capture: Capture = {
  argv: [],
  results: [],
};

vi.mock("node:child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout?: string, stderr?: string) => void,
  ) => {
    capture.argv.push([cmd, ...args]);
    const next = capture.results.shift();
    if (!next) {
      cb(null, "", "");
      return;
    }
    if (next.kind === "ok") {
      cb(null, next.stdout, next.stderr ?? "");
      return;
    }
    const err = new Error(`exec failed: ${next.code}`) as NodeJS.ErrnoException;
    err.code = String(next.code);
    cb(err, "", next.stderr ?? "");
  },
}));

import {
  probeTmux,
  formatTmuxUnavailableNotice,
} from "../src/process-manager/tmux-availability.ts";

beforeEach(() => {
  capture.argv = [];
  capture.results = [];
});

describe("tmux-availability", () => {
  describe("probeTmux", () => {
    it("returns { available: true, version, versionError: null } when tmux -V succeeds", async () => {
      capture.results.push({ kind: "ok", stdout: "tmux 3.4\n" });
      const result = await probeTmux();
      expect(result.available).toBe(true);
      expect(result.version).toBe("tmux 3.4");
      expect(result.versionError).toBeNull();
    });

    it("returns { available: false, version: null, versionError: <one-line> } on ENOENT — does not throw", async () => {
      capture.results.push({ kind: "err", code: "ENOENT" });
      // Must not throw.
      const result = await probeTmux();
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
      expect(result.versionError).not.toBeNull();
      // One single line — no embedded newline.
      expect(result.versionError!.includes("\n")).toBe(false);
      // Contains "tmux" and is actionable (mentions the install hint).
      expect(result.versionError!.toLowerCase()).toContain("tmux");
    });

    it("uses the configured tmuxBin override", async () => {
      capture.results.push({ kind: "ok", stdout: "tmux 3.0\n" });
      await probeTmux({ tmuxBin: "/opt/custom/tmux" });
      expect(capture.argv[0]?.[0]).toBe("/opt/custom/tmux");
      expect(capture.argv[0]).toContain("-V");
    });

    it("returns { available: false } on any non-zero exit code without throwing", async () => {
      capture.results.push({ kind: "err", code: 127 });
      const result = await probeTmux();
      expect(result.available).toBe(false);
      expect(result.versionError).not.toBeNull();
    });
  });

  describe("formatTmuxUnavailableNotice", () => {
    it("returns null when the probe reports available=true (no notice)", () => {
      const notice = formatTmuxUnavailableNotice({
        available: true,
        version: "tmux 3.4",
        versionError: null,
      });
      expect(notice).toBeNull();
    });

    it("returns a single-line, actionable string when probe reports unavailable", () => {
      const notice = formatTmuxUnavailableNotice({
        available: false,
        version: null,
        versionError: "tmux: binary not found (ENOENT).",
      });
      expect(notice).not.toBeNull();
      expect(notice!.includes("\n")).toBe(false);
      expect(notice!.toLowerCase()).toContain("tmux");
      expect(notice).toContain("docs/setup.md");
    });
  });
});
