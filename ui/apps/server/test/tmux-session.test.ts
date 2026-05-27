import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock node:child_process before importing the module under test.
// We replace `execFile` with a recorded fake that the suite controls.
type Capture = {
  argv: string[][];
  stdoutByCmd: Map<string, string>;
  rcByCmd: Map<string, number>;
  errorOnNext?: NodeJS.ErrnoException;
};
const capture: Capture = {
  argv: [],
  stdoutByCmd: new Map(),
  rcByCmd: new Map(),
};

vi.mock("node:child_process", () => {
  return {
    execFile: (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      capture.argv.push([cmd, ...args]);
      if (capture.errorOnNext) {
        const err = capture.errorOnNext;
        capture.errorOnNext = undefined;
        cb(err);
        return;
      }
      const key = [cmd, ...args].join(" ");
      const subcmd = args[0] ?? "";
      const rc = capture.rcByCmd.get(subcmd) ?? 0;
      if (rc !== 0) {
        const err = new Error(`exit code ${rc}`) as Error & { code?: number };
        err.code = rc;
        cb(err);
      } else {
        cb(null, capture.stdoutByCmd.get(subcmd) ?? "", "");
      }
      void key;
    },
  };
});

import { createTmuxSession } from "../src/process-manager/tmux-session.ts";

beforeEach(() => {
  capture.argv = [];
  capture.stdoutByCmd = new Map();
  capture.rcByCmd = new Map();
  capture.errorOnNext = undefined;
});

describe("tmux-session", () => {
  it("ensure: idempotent — does not call new-session when has-session succeeds", async () => {
    capture.rcByCmd.set("has-session", 0); // session already exists
    const tmux = createTmuxSession();
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid");
    const cmds = capture.argv.map((a) => a[1]);
    expect(cmds).toContain("has-session");
    expect(cmds).not.toContain("new-session");
  });

  it("ensure: when has-session fails (exit 1), shells out to new-session exactly once", async () => {
    capture.rcByCmd.set("has-session", 1); // not present
    capture.rcByCmd.set("new-session", 0);
    const tmux = createTmuxSession();
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid");
    const newSessCalls = capture.argv.filter((a) => a[1] === "new-session");
    expect(newSessCalls.length).toBe(1);
    const call = newSessCalls[0]!;
    // Expect: tmux new-session -d -s loom-c-1 -c /tmp/cwd -- claude --session-id sess-uuid
    expect(call[0]).toBe("tmux");
    expect(call).toContain("-d");
    expect(call).toContain("-s");
    expect(call).toContain("loom-c-1");
    expect(call).toContain("-c");
    expect(call).toContain("/tmp/cwd");
    expect(call).toContain("--");
    expect(call).toContain("claude");
    expect(call).toContain("--session-id");
    expect(call).toContain("sess-uuid");
  });

  it("ensure: bypassPermissions appends --dangerously-skip-permissions to the claude argv", async () => {
    capture.rcByCmd.set("has-session", 1);
    capture.rcByCmd.set("new-session", 0);
    const tmux = createTmuxSession();
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid", "bypassPermissions");
    const call = capture.argv.find((a) => a[1] === "new-session")!;
    expect(call).toContain("--dangerously-skip-permissions");
    expect(call).not.toContain("--permission-mode");
    // Flag lands after --session-id <uuid>, i.e. inside the claude arg
    // tail rather than as a tmux option.
    const dashDash = call.indexOf("--");
    const flagIdx = call.indexOf("--dangerously-skip-permissions");
    expect(flagIdx).toBeGreaterThan(dashDash);
  });

  it("ensure: plan / acceptEdits append --permission-mode <m> to the claude argv", async () => {
    capture.rcByCmd.set("has-session", 1);
    capture.rcByCmd.set("new-session", 0);
    const tmux = createTmuxSession();
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid", "acceptEdits");
    const acceptCall = capture.argv.find((a) => a[1] === "new-session")!;
    expect(acceptCall).toContain("--permission-mode");
    expect(acceptCall).toContain("acceptEdits");

    capture.argv = [];
    capture.rcByCmd.set("has-session", 1);
    await tmux.ensure("c-2", "/tmp/cwd", "sess-uuid-2", "plan");
    const planCall = capture.argv.find((a) => a[1] === "new-session")!;
    expect(planCall).toContain("--permission-mode");
    expect(planCall).toContain("plan");
  });

  it("ensure: default (and omitted) permission mode adds no extra claude flags", async () => {
    capture.rcByCmd.set("has-session", 1);
    capture.rcByCmd.set("new-session", 0);
    const tmux = createTmuxSession();
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid");
    const call = capture.argv.find((a) => a[1] === "new-session")!;
    expect(call).not.toContain("--dangerously-skip-permissions");
    expect(call).not.toContain("--permission-mode");
  });

  it("ensure: calling twice for the same chatId still produces exactly one new-session (when the second call sees has-session=0)", async () => {
    // First call: has-session=1 (creates), Second call: has-session=0 (skips)
    let counter = 0;
    capture.rcByCmd.set("new-session", 0);
    const origRcByCmd = capture.rcByCmd;
    // Override has-session via dynamic logic: re-mock child_process is heavy; we
    // simulate by toggling the map between calls.
    const tmux = createTmuxSession();
    capture.rcByCmd = new Map(origRcByCmd);
    capture.rcByCmd.set("has-session", 1);
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid");
    capture.rcByCmd.set("has-session", 0);
    await tmux.ensure("c-1", "/tmp/cwd", "sess-uuid");
    counter = capture.argv.filter((a) => a[1] === "new-session").length;
    expect(counter).toBe(1);
  });

  it("kill: idempotent — missing session does not throw", async () => {
    capture.rcByCmd.set("kill-session", 1); // tmux returns non-zero when missing
    const tmux = createTmuxSession();
    await expect(tmux.kill("c-missing")).resolves.toBeUndefined();
  });

  it("kill: when session exists, shells out tmux kill-session -t loom-<chatId>", async () => {
    capture.rcByCmd.set("kill-session", 0);
    const tmux = createTmuxSession();
    await tmux.kill("c-1");
    const killCalls = capture.argv.filter((a) => a[1] === "kill-session");
    expect(killCalls.length).toBe(1);
    expect(killCalls[0]).toContain("loom-c-1");
  });

  it("sendInput: passes text via tmux send-keys -l -- <text>, then Enter", async () => {
    capture.rcByCmd.set("send-keys", 0);
    const tmux = createTmuxSession();
    await tmux.sendInput("c-1", "hello world");
    const sendCalls = capture.argv.filter((a) => a[1] === "send-keys");
    // Two send-keys calls: one for the literal text, one for Enter.
    expect(sendCalls.length).toBe(2);
    const literal = sendCalls[0]!;
    expect(literal).toContain("-t");
    expect(literal).toContain("loom-c-1");
    expect(literal).toContain("-l");
    expect(literal).toContain("--");
    expect(literal).toContain("hello world");
    // Enter call uses the key name, no -l flag.
    const enter = sendCalls[1]!;
    expect(enter).toContain("loom-c-1");
    expect(enter).toContain("Enter");
    expect(enter).not.toContain("-l");
  });

  it("sendInput: literal mode preserves newlines, shell-meta, control chars verbatim", async () => {
    capture.rcByCmd.set("send-keys", 0);
    const tricky = "line1\nline2\t$(echo pwn)\\backslash";
    const tmux = createTmuxSession();
    await tmux.sendInput("c-1", tricky);
    const literal = capture.argv.find((a) => a[1] === "send-keys" && a.includes("-l"))!;
    // The literal text MUST appear in argv exactly as-is (no quoting, no
    // escape, no shell evaluation — argv-mode execFile passes argv array).
    expect(literal).toContain(tricky);
  });

  it("sendInput: each argument is in its own argv slot (no string concatenation)", async () => {
    capture.rcByCmd.set("send-keys", 0);
    const tmux = createTmuxSession();
    await tmux.sendInput("c-1", "payload");
    const literal = capture.argv.find((a) => a[1] === "send-keys" && a.includes("-l"))!;
    // 'payload' must appear as its own argv entry, not concatenated with
    // adjacent flags. (Otherwise the literal-mode contract leaks through
    // a shell.)
    expect(literal.indexOf("payload")).toBeGreaterThan(0);
    expect(literal).not.toContain("-- payload");
  });

  it("sendKey: passes the key via tmux send-keys -- <key> (key-name mode, no -l, no Enter)", async () => {
    capture.rcByCmd.set("send-keys", 0);
    const tmux = createTmuxSession();
    await tmux.sendKey("c-1", "Right");
    const sendCalls = capture.argv.filter((a) => a[1] === "send-keys");
    // Exactly one send-keys call — the bare key, no trailing Enter.
    expect(sendCalls.length).toBe(1);
    const key = sendCalls[0]!;
    expect(key).toContain("loom-c-1");
    expect(key).toContain("--");
    expect(key).toContain("Right");
    expect(key).not.toContain("Enter");
    // Key-name mode (no -l): "Right" must resolve as the arrow key, not be
    // typed literally.
    expect(key).not.toContain("-l");
  });

  it("interrupt: sends Escape via tmux send-keys to the loom-<chatId> target", async () => {
    capture.rcByCmd.set("send-keys", 0);
    const tmux = createTmuxSession();
    await tmux.interrupt("c-1");
    const sendCalls = capture.argv.filter((a) => a[1] === "send-keys");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0]).toContain("loom-c-1");
    expect(sendCalls[0]).toContain("Escape");
    // Interrupt MUST NOT use literal mode (Escape is a key name).
    expect(sendCalls[0]).not.toContain("-l");
  });

  it("exists: returns true when tmux has-session succeeds (rc=0)", async () => {
    capture.rcByCmd.set("has-session", 0);
    const tmux = createTmuxSession();
    expect(await tmux.exists("c-1")).toBe(true);
  });

  it("exists: returns false when tmux has-session fails (rc=1)", async () => {
    capture.rcByCmd.set("has-session", 1);
    const tmux = createTmuxSession();
    expect(await tmux.exists("c-missing")).toBe(false);
  });

  it("exists: does NOT cache — every call shells out", async () => {
    capture.rcByCmd.set("has-session", 0);
    const tmux = createTmuxSession();
    await tmux.exists("c-1");
    await tmux.exists("c-1");
    const calls = capture.argv.filter((a) => a[1] === "has-session");
    expect(calls.length).toBe(2);
  });

  it("ensure: ENOENT on tmux binary surfaces as a typed error", async () => {
    const err = new Error("spawn tmux ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    capture.errorOnNext = err;
    const tmux = createTmuxSession();
    await expect(tmux.ensure("c-1", "/tmp/cwd", "sess-uuid")).rejects.toThrow(
      /tmux/i,
    );
  });

  // ─── Availability getter — T-023 (M3 fix) ───────────────────────────
  describe("availability getter (T-023)", () => {
    it("ensure: throws TmuxUnavailableError without invoking execFile when availability.available=false", async () => {
      const { TmuxUnavailableError } = await import(
        "../src/process-manager/tmux-availability.ts"
      );
      const tmux = createTmuxSession({
        availability: () => ({ available: false }),
      });
      await expect(
        tmux.ensure("c-1", "/tmp/cwd", "sess-uuid"),
      ).rejects.toBeInstanceOf(TmuxUnavailableError);
      expect(capture.argv.length).toBe(0);
    });

    it("sendInput: throws TmuxUnavailableError without invoking execFile when unavailable", async () => {
      const { TmuxUnavailableError } = await import(
        "../src/process-manager/tmux-availability.ts"
      );
      const tmux = createTmuxSession({
        availability: () => ({ available: false }),
      });
      await expect(tmux.sendInput("c-1", "hello")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
      expect(capture.argv.length).toBe(0);
    });

    it("interrupt: throws TmuxUnavailableError without invoking execFile when unavailable", async () => {
      const { TmuxUnavailableError } = await import(
        "../src/process-manager/tmux-availability.ts"
      );
      const tmux = createTmuxSession({
        availability: () => ({ available: false }),
      });
      await expect(tmux.interrupt("c-1")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
      expect(capture.argv.length).toBe(0);
    });

    it("exists: resolves false without invoking execFile when unavailable", async () => {
      const tmux = createTmuxSession({
        availability: () => ({ available: false }),
      });
      const r = await tmux.exists("c-1");
      expect(r).toBe(false);
      expect(capture.argv.length).toBe(0);
    });

    it("kill: resolves no-op without invoking execFile when unavailable (idempotent contract)", async () => {
      const tmux = createTmuxSession({
        availability: () => ({ available: false }),
      });
      await expect(tmux.kill("c-1")).resolves.toBeUndefined();
      expect(capture.argv.length).toBe(0);
    });

    it("availability getter is re-read on every call (allows runtime flip)", async () => {
      let available = false;
      capture.rcByCmd.set("has-session", 0);
      const tmux = createTmuxSession({
        availability: () => ({ available }),
      });
      expect(await tmux.exists("c-1")).toBe(false);
      expect(capture.argv.length).toBe(0);
      available = true;
      expect(await tmux.exists("c-1")).toBe(true);
      expect(capture.argv.length).toBe(1);
    });

    it("when availability is omitted, behaviour is unchanged (regression guard for 14 existing cases)", async () => {
      // Smoke: the default path is preserved when no `availability` getter is wired.
      capture.rcByCmd.set("has-session", 0);
      const tmux = createTmuxSession();
      expect(await tmux.exists("c-1")).toBe(true);
      expect(capture.argv.length).toBe(1);
    });
  });

  it("structural: the module source contains no setTimeout / setInterval (no drain timer)", async () => {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "..", "src", "process-manager", "tmux-session.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\bsetTimeout\b/);
    expect(src).not.toMatch(/\bsetInterval\b/);
  });
});
