/**
 * T-007 — process-manager/handoff.ts launcher (US-003).
 *
 * Tests the platform-specific terminal launch logic with a stubbed
 * `child_process.spawn`. macOS uses Terminal.app; Linux iterates a
 * fallback chain; Windows returns an inline failure without spawning.
 */
import { describe, expect, test } from "vitest";
import {
  launchHandoffTerminal,
  type SpawnFn,
  type WhichFn,
} from "../src/process-manager/handoff.ts";

function fakeChild() {
  return { pid: 4711, unref: () => {} } as any;
}

const minimalSession = { chatId: "chat-xyz", port: 4123 };

describe("T-007 launchHandoffTerminal — macOS", () => {
  test("invokes `open -a Terminal.app -n --args ...` and returns ok", async () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const spawn: SpawnFn = (cmd, args) => {
      calls.push({ cmd, args: args as readonly string[] });
      return fakeChild();
    };
    const which: WhichFn = () => null;
    const result = await launchHandoffTerminal(minimalSession, {
      platform: "darwin",
      spawn,
      which,
    });
    expect(result.ok).toBe(true);
    expect(typeof result.launched?.command).toBe("string");
    expect(result.launched!.pid).toBe(4711);
    expect(calls.length).toBe(1);
    expect(calls[0]!.cmd).toBe("open");
    expect(calls[0]!.args.join(" ")).toContain("Terminal.app");
    expect(calls[0]!.args.join(" ")).toContain(minimalSession.chatId);
  });
});

describe("T-007 launchHandoffTerminal — Linux", () => {
  test("first-hit wins in the fallback chain (gnome-terminal)", async () => {
    const calls: Array<{ cmd: string }> = [];
    const spawn: SpawnFn = (cmd) => {
      calls.push({ cmd });
      return fakeChild();
    };
    const which: WhichFn = (cmd) => (cmd === "gnome-terminal" ? "/usr/bin/gnome-terminal" : null);
    const result = await launchHandoffTerminal(minimalSession, {
      platform: "linux",
      spawn,
      which,
    });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.cmd).toBe("gnome-terminal");
  });

  test("falls through past gnome-terminal to konsole when only konsole resolves", async () => {
    const calls: Array<{ cmd: string }> = [];
    const spawn: SpawnFn = (cmd) => {
      calls.push({ cmd });
      return fakeChild();
    };
    const which: WhichFn = (cmd) => (cmd === "konsole" ? "/usr/bin/konsole" : null);
    const result = await launchHandoffTerminal(minimalSession, {
      platform: "linux",
      spawn,
      which,
    });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]!.cmd).toBe("konsole");
  });

  test("returns ok=false without spawning when no terminal resolves", async () => {
    const calls: Array<{ cmd: string }> = [];
    const spawn: SpawnFn = (cmd) => {
      calls.push({ cmd });
      return fakeChild();
    };
    const which: WhichFn = () => null;
    const result = await launchHandoffTerminal(minimalSession, {
      platform: "linux",
      spawn,
      which,
    });
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(calls.length).toBe(0);
  });
});

describe("T-007 launchHandoffTerminal — Windows", () => {
  test("returns ok=false without spawning anything", async () => {
    const calls: Array<unknown> = [];
    const spawn: SpawnFn = (...args) => {
      calls.push(args);
      return fakeChild();
    };
    const which: WhichFn = () => null;
    const result = await launchHandoffTerminal(minimalSession, {
      platform: "win32",
      spawn,
      which,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/windows/i);
    expect(calls.length).toBe(0);
  });
});
