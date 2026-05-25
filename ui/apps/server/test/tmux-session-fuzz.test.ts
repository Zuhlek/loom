/**
 * T-018 — `tmux send-keys -l --` literal-mode fuzz.
 *
 * For each entry in `send-keys-fuzz.ts`, calling `tmux.sendInput` MUST
 * produce an argv whose last three slots are `["-l", "--", input]` and
 * a subsequent Enter argv. The fuzz suite is the load-bearing assertion
 * that user-typed bytes reach `claude` verbatim.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SEND_KEYS_FUZZ_INPUTS } from "./fixtures/send-keys-fuzz.ts";

type Capture = { argv: string[][] };
const capture: Capture = { argv: [] };

vi.mock("node:child_process", () => {
  return {
    execFile: (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      capture.argv.push([cmd, ...args]);
      cb(null, "", "");
    },
  };
});

import { createTmuxSession } from "../src/process-manager/tmux-session.ts";

beforeEach(() => {
  capture.argv = [];
});

describe("tmux-session — send-keys literal-mode fuzz (T-018)", () => {
  for (const fx of SEND_KEYS_FUZZ_INPUTS) {
    it(`fuzz: ${fx.name} reaches tmux argv byte-for-byte`, async () => {
      const tmux = createTmuxSession({ buildEnv: () => ({}) });
      await tmux.sendInput("c-1", fx.input);
      // First argv carries the literal text; second argv sends Enter.
      const literalArgv = capture.argv[0]!;
      // shape: ["tmux", "send-keys", "-t", "loom-c-1", "-l", "--", text]
      expect(literalArgv[0]).toBe("tmux");
      expect(literalArgv[1]).toBe("send-keys");
      expect(literalArgv[2]).toBe("-t");
      expect(literalArgv[3]).toBe("loom-c-1");
      expect(literalArgv[4]).toBe("-l");
      expect(literalArgv[5]).toBe("--");
      expect(literalArgv[6]).toBe(fx.input);
      expect(literalArgv).toHaveLength(7);
      const enterArgv = capture.argv[1]!;
      expect(enterArgv).toEqual([
        "tmux",
        "send-keys",
        "-t",
        "loom-c-1",
        "Enter",
      ]);
    });
  }
});
