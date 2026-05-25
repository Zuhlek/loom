import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJsonlPathProbe,
  ProbeError,
  type ProbeDriver,
  type ResolvedTailRoot,
} from "../src/process-manager/jsonl-path-probe.ts";

let dir: string;
let storagePath: string;
let claudeHome: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-probe-"));
  storagePath = join(dir, "jsonl-tail-root.json");
  claudeHome = join(dir, ".claude");
});

/**
 * Build a probe driver that simulates `claude` writing a JSONL file
 * under `<claudeHome>/projects/<encodedCwd>/<sessionId>.jsonl`.
 */
function mkSimulatedDriver(opts: {
  observeRoot: string;
  delayMs?: number;
  failToProduceFile?: boolean;
}): ProbeDriver {
  return {
    discoverRoots() {
      return [opts.observeRoot];
    },
    async invokeClaudeBenignSession(probeMeta) {
      if (opts.failToProduceFile) return;
      const dirEnc = join(
        opts.observeRoot,
        "projects",
        probeMeta.encodedCwd,
      );
      mkdirSync(dirEnc, { recursive: true });
      const file = join(dirEnc, `${probeMeta.probeSessionId}.jsonl`);
      // Simulate the file appearing after a short delay.
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 5));
      writeFileSync(file, `{"type":"summary"}\n`, "utf8");
    },
    async getClaudeVersion() {
      return "1.2.3";
    },
  };
}

describe("jsonl-path-probe", () => {
  it("first resolve: no persisted value → runs probe, persists, returns ResolvedTailRoot", async () => {
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 5000,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    const r = await probe.resolve();
    expect(r.tailRoot).toBe(join(claudeHome, "projects"));
    expect(r.encodingScheme).toBe("cwd-slash-encoded");
    expect(typeof r.resolvedAt).toBe("string");
    expect(r.claudeVersionAtProbe).toBe("1.2.3");
  });

  it("subsequent resolve returns the persisted value without re-probing", async () => {
    let probeCalls = 0;
    const driver: ProbeDriver = {
      discoverRoots: () => [claudeHome],
      invokeClaudeBenignSession: async (meta) => {
        probeCalls++;
        const dirEnc = join(claudeHome, "projects", meta.encodedCwd);
        mkdirSync(dirEnc, { recursive: true });
        writeFileSync(join(dirEnc, `${meta.probeSessionId}.jsonl`), "{}\n", "utf8");
      },
      getClaudeVersion: async () => "1.2.3",
    };
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 5000,
      driver,
    });
    const first = await probe.resolve();
    const second = await probe.resolve();
    expect(probeCalls).toBe(1);
    expect(second.tailRoot).toBe(first.tailRoot);
    expect(second.resolvedAt).toBe(first.resolvedAt);
  });

  it("reprobe forces a fresh probe and overwrites persistence", async () => {
    let probeCalls = 0;
    const driver: ProbeDriver = {
      discoverRoots: () => [claudeHome],
      invokeClaudeBenignSession: async (meta) => {
        probeCalls++;
        const dirEnc = join(claudeHome, "projects", meta.encodedCwd);
        mkdirSync(dirEnc, { recursive: true });
        writeFileSync(join(dirEnc, `${meta.probeSessionId}.jsonl`), "{}\n", "utf8");
      },
      getClaudeVersion: async () => "1.2.3",
    };
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 5000,
      driver,
    });
    const first = await probe.resolve();
    const reprobed = await probe.reprobe();
    expect(probeCalls).toBe(2);
    expect(reprobed.tailRoot).toBe(first.tailRoot);
    // The resolvedAt should advance.
    expect(new Date(reprobed.resolvedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.resolvedAt).getTime(),
    );
  });

  it("failure: probe times out without observing a JSONL file → rejects with ProbeError carrying actionable text", async () => {
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 50, // short
      driver: mkSimulatedDriver({
        observeRoot: claudeHome,
        failToProduceFile: true,
      }),
    });
    let caught: unknown = null;
    try {
      await probe.resolve();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProbeError);
    expect(String(caught)).toMatch(/jsonl/i);
  });

  it("does NOT silently fall back to ~/.claude/projects when the probe times out", async () => {
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 50,
      driver: mkSimulatedDriver({
        observeRoot: claudeHome,
        failToProduceFile: true,
      }),
    });
    await expect(probe.resolve()).rejects.toBeInstanceOf(ProbeError);
    // No persistence written on failure.
    const fs = await import("node:fs/promises");
    let exists = true;
    try {
      await fs.stat(storagePath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("encodeCwd: known cwd strings round-trip to the encoded segment", () => {
    const probe = createJsonlPathProbe({
      storagePath,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    // Claude's encoding scheme replaces `/` with `-`.
    expect(probe.encodeCwd("/Users/x/projects/loom")).toBe(
      "-Users-x-projects-loom",
    );
    expect(probe.encodeCwd("/")).toBe("-");
    expect(probe.encodeCwd("")).toBe("");
  });

  it("encodeCwd: paths with whitespace are encoded the way claude observes them (M6 root cause #2)", () => {
    const probe = createJsonlPathProbe({
      storagePath,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    // Observed on the user's host: `/Volumes/My Shared Files/repo/loom`
    // → `-Volumes-My-Shared-Files-repo-loom`. Spaces are dashes, not
    // preserved literally.
    expect(probe.encodeCwd("/Volumes/My Shared Files/repo/loom")).toBe(
      "-Volumes-My-Shared-Files-repo-loom",
    );
    // Tabs / multi-space runs collapse the way claude does — one
    // separator yields one dash, not a chain of empty segments.
    expect(probe.encodeCwd("/a b/c\td")).toBe("-a-b-c-d");
  });

  it("encodeCwd: stable across distinct probe instances", () => {
    const a = createJsonlPathProbe({
      storagePath,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    const b = createJsonlPathProbe({
      storagePath,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    expect(a.encodeCwd("/Users/x")).toBe(b.encodeCwd("/Users/x"));
  });

  it("resolve: persisted ResolvedTailRoot survives a fresh probe instance against the same storagePath", async () => {
    const probe = createJsonlPathProbe({
      storagePath,
      timeoutMs: 5000,
      driver: mkSimulatedDriver({ observeRoot: claudeHome }),
    });
    const a: ResolvedTailRoot = await probe.resolve();

    const fresh = createJsonlPathProbe({
      storagePath,
      driver: {
        discoverRoots: () => {
          throw new Error("must not be called — fresh instance must read persisted value");
        },
        invokeClaudeBenignSession: async () => {
          throw new Error("must not be called");
        },
        getClaudeVersion: async () => "x",
      },
    });
    const b = await fresh.resolve();
    expect(b).toEqual(a);
  });

  it("[cleanup]", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
