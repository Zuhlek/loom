import { describe, expect, it, vi, beforeEach } from "vitest";

type ExecFileCallback = (
  err: NodeJS.ErrnoException | null,
  stdout?: string,
  stderr?: string,
) => void;

interface FakeCall {
  cmd: string;
  args: string[];
}

interface FakeResponder {
  (cmd: string, args: string[]): {
    stdout?: string;
    stderr?: string;
    code?: number;
    errnoCode?: string;
  } | null;
}

const fake = {
  calls: [] as FakeCall[],
  respond: (() => ({ stdout: "", code: 0 })) as FakeResponder,
};

vi.mock("node:child_process", () => {
  return {
    execFile: (
      cmd: string,
      args: string[],
      cb: ExecFileCallback,
    ) => {
      fake.calls.push({ cmd, args });
      const r = fake.respond(cmd, args);
      if (r === null) {
        cb(null, "", "");
        return;
      }
      if (r.errnoCode) {
        const err = new Error(`spawn ${cmd} ${r.errnoCode}`) as NodeJS.ErrnoException;
        err.code = r.errnoCode;
        cb(err);
        return;
      }
      if (r.code && r.code !== 0) {
        const err = new Error(`exit ${r.code}`) as Error & { code?: number };
        err.code = r.code;
        cb(err as NodeJS.ErrnoException, r.stdout ?? "", r.stderr ?? "");
        return;
      }
      cb(null, r.stdout ?? "", r.stderr ?? "");
    },
  };
});

import { createPaneProcessApi } from "../src/process-manager/pane-process.ts";

beforeEach(() => {
  fake.calls = [];
  fake.respond = () => ({ stdout: "", code: 0 });
});

describe("pane-process — paneRootPid", () => {
  it("parses the first non-empty line from tmux list-panes output", async () => {
    fake.respond = (cmd, args) => {
      if (cmd === "tmux" && args[0] === "list-panes") {
        return { stdout: "98765\n", code: 0 };
      }
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    const pid = await api.paneRootPid("c-1");
    expect(pid).toBe(98765);
    expect(fake.calls[0]!.args).toEqual([
      "list-panes",
      "-t",
      "loom-c-1",
      "-F",
      "#{pane_pid}",
    ]);
  });

  it("returns null on tmux non-zero exit (no pane)", async () => {
    fake.respond = () => ({ code: 1 });
    const api = createPaneProcessApi();
    const pid = await api.paneRootPid("missing");
    expect(pid).toBeNull();
  });

  it("returns null on unparseable tmux output", async () => {
    fake.respond = () => ({ stdout: "not-a-number\n", code: 0 });
    const api = createPaneProcessApi();
    expect(await api.paneRootPid("c-1")).toBeNull();
  });

  it("returns null on empty tmux output", async () => {
    fake.respond = () => ({ stdout: "", code: 0 });
    const api = createPaneProcessApi();
    expect(await api.paneRootPid("c-1")).toBeNull();
  });
});

describe("pane-process — paneOwnsFile", () => {
  it("returns true when a holder's direct parent is the ancestor", async () => {
    const ancestor = 1000;
    const writer = 2000;
    const target = "/tmp/foo.jsonl";
    fake.respond = (cmd, args) => {
      if (cmd === "lsof") {
        return { stdout: `p${writer}\nn${target}\n`, code: 0 };
      }
      if (cmd === "ps" && args.includes("-p") && args.includes(String(writer))) {
        return { stdout: `${ancestor}\n`, code: 0 };
      }
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(ancestor, target)).toBe(true);
  });

  it("returns true when the ancestor is two levels up the chain", async () => {
    const ancestor = 1000;
    const middle = 1500;
    const writer = 2000;
    const target = "/tmp/two.jsonl";
    fake.respond = (cmd, args) => {
      if (cmd === "lsof") {
        return { stdout: `p${writer}\nn${target}\n`, code: 0 };
      }
      if (cmd === "ps") {
        const idx = args.indexOf("-p");
        const pid = parseInt(args[idx + 1] ?? "", 10);
        if (pid === writer) return { stdout: `${middle}\n`, code: 0 };
        if (pid === middle) return { stdout: `${ancestor}\n`, code: 0 };
        return { stdout: "1\n", code: 0 };
      }
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(ancestor, target)).toBe(true);
  });

  it("returns false when no writer has the ancestor in its chain", async () => {
    const ancestor = 9999;
    const writer = 2000;
    const target = "/tmp/notmine.jsonl";
    fake.respond = (cmd, args) => {
      if (cmd === "lsof") {
        return { stdout: `p${writer}\nn${target}\n`, code: 0 };
      }
      if (cmd === "ps") {
        const idx = args.indexOf("-p");
        const pid = parseInt(args[idx + 1] ?? "", 10);
        if (pid === writer) return { stdout: "5\n", code: 0 };
        if (pid === 5) return { stdout: "1\n", code: 0 };
        return { stdout: "1\n", code: 0 };
      }
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(ancestor, target)).toBe(false);
  });

  it("returns false when lsof reports no holders (exit non-zero)", async () => {
    fake.respond = (cmd) => {
      if (cmd === "lsof") return { code: 1, stdout: "" };
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(1234, "/tmp/empty.jsonl")).toBe(false);
  });

  it("returns false when lsof output's `n` field does not match the target path", async () => {
    // Defensive: lsof may also list mmap entries with different paths.
    fake.respond = (cmd) => {
      if (cmd === "lsof") {
        return {
          stdout: "p2000\nn/some/other/path\n",
          code: 0,
        };
      }
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(1000, "/tmp/target.jsonl")).toBe(false);
  });

  it("kill-switch (LOOM_DISABLE_PANE_PID_GATE) returns true without shelling out", async () => {
    let called = false;
    fake.respond = () => {
      called = true;
      return { code: 0 };
    };
    const api = createPaneProcessApi({
      disabledByEnv: () => true,
    });
    expect(await api.paneOwnsFile(1234, "/tmp/whatever.jsonl")).toBe(true);
    expect(called).toBe(false);
  });

  it("degrades to allow-all when lsof binary is missing (ENOENT)", async () => {
    fake.respond = (cmd) => {
      if (cmd === "lsof") return { errnoCode: "ENOENT" };
      return { code: 1 };
    };
    const api = createPaneProcessApi();
    expect(await api.paneOwnsFile(1234, "/tmp/whatever.jsonl")).toBe(true);
  });
});
