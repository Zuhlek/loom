import { describe, it, expect } from "vitest";
import { buildClaudeSpawnEnv } from "../src/process-manager/claude-env.ts";

describe("buildClaudeSpawnEnv", () => {
  it("strips VS Code Claude Code extension IDE-handshake vars", () => {
    const out = buildClaudeSpawnEnv({
      HOME: "/Users/tk",
      PATH: "/usr/bin",
      CLAUDE_CODE_SSE_PORT: "31468",
      CLAUDE_CODE_AUTO_CONNECT_IDE: "1",
      CLAUDE_CODE_IDE_HOST_OVERRIDE: "vscode",
    });
    expect(out.HOME).toBe("/Users/tk");
    expect(out.PATH).toBe("/usr/bin");
    expect(out.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    expect(out.CLAUDE_CODE_AUTO_CONNECT_IDE).toBeUndefined();
    expect(out.CLAUDE_CODE_IDE_HOST_OVERRIDE).toBeUndefined();
  });

  it("strips VS Code git-askpass and bundle-identifier vars", () => {
    const out = buildClaudeSpawnEnv({
      VSCODE_GIT_ASKPASS_MAIN: "/path/to/askpass-main.js",
      VSCODE_GIT_ASKPASS_NODE: "/path/to/Code Helper",
      VSCODE_GIT_ASKPASS_EXTRA_ARGS: "",
      VSCODE_GIT_IPC_HANDLE: "/tmp/vscode-git.sock",
      GIT_ASKPASS: "/path/to/askpass.sh",
      __CFBundleIdentifier: "com.microsoft.VSCode",
      TERM_PROGRAM: "vscode",
      TERM_PROGRAM_VERSION: "1.107.1",
    });
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("strips loom-internal and electron leakage vars", () => {
    const out = buildClaudeSpawnEnv({
      LOOM_PORT: "3737",
      LOOM_CLAUDE_BIN: "/some/claude",
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_RENDERER_PORT: "5000",
      KEEP_ME: "yes",
    });
    expect(out).toEqual({ KEEP_ME: "yes" });
  });

  it("passes through unrelated vars unchanged", () => {
    const out = buildClaudeSpawnEnv({
      HOME: "/Users/tk",
      USER: "tk",
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/zsh",
      LANG: "en_US.UTF-8",
      COLORTERM: "truecolor",
    });
    expect(out).toEqual({
      HOME: "/Users/tk",
      USER: "tk",
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/zsh",
      LANG: "en_US.UTF-8",
      COLORTERM: "truecolor",
    });
  });

  it("drops undefined values", () => {
    const out = buildClaudeSpawnEnv({
      HOME: "/Users/tk",
      SOMETHING_UNDEFINED: undefined,
    });
    expect(out).toEqual({ HOME: "/Users/tk" });
  });
});