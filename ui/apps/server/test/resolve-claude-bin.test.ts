/**
 * Claude-binary resolution.
 *
 * Getting this wrong is silent: `tmux new-session` exits 0 even when it cannot
 * exec the command, so an unresolved binary yields panes that die on spawn and
 * chats whose every send fails with an opaque `send-keys` error. The bundled
 * editor binary has to be found under EVERY extensions root, not just
 * ~/.vscode — remote and code-server installs (Coder CDE workspaces) put it
 * elsewhere, which is exactly the case that shipped broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Seeded with a real directory because modules under test compute paths from
// `homedir()` at import time; `beforeEach` swaps in a fresh fixture per test.
let home: string = tmpdir();

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

const { resolveClaudeBin } = await import("../src/index.ts");

/** Drop an executable stub at `<home>/<relDir>/<name>`. */
function writeExecutable(relDir: string, name: string): string {
  const dir = join(home, relDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
  return file;
}

function bundle(root: string, version: string): string {
  return writeExecutable(
    join(root, `anthropic.claude-code-${version}-linux-x64`, "resources", "native-binary"),
    "claude",
  );
}

describe("resolveClaudeBin", () => {
  let realPath: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "resolve-claude-bin-"));
    // A real `claude` on the developer's PATH would outrank every fixture.
    realPath = process.env.PATH;
    process.env.PATH = "";
    delete process.env.LOOM_CLAUDE_BIN;
  });

  afterEach(() => {
    process.env.PATH = realPath;
    rmSync(home, { recursive: true, force: true });
  });

  it("finds the bundle under ~/.vscode/extensions", () => {
    const expected = bundle(join(".vscode", "extensions"), "2.1.220");
    expect(resolveClaudeBin()).toBe(expected);
  });

  it("finds the bundle under ~/.vscode-server/extensions (remote)", () => {
    const expected = bundle(join(".vscode-server", "extensions"), "2.1.220");
    expect(resolveClaudeBin()).toBe(expected);
  });

  it("finds the bundle under ~/.local/share/code-server/extensions", () => {
    const expected = bundle(join(".local", "share", "code-server", "extensions"), "2.1.220");
    expect(resolveClaudeBin()).toBe(expected);
  });

  it("prefers the newest version within a root", () => {
    bundle(join(".local", "share", "code-server", "extensions"), "2.1.99");
    const newest = bundle(join(".local", "share", "code-server", "extensions"), "2.1.220");
    expect(resolveClaudeBin()).toBe(newest);
  });

  it("prefers the official local install over a bundle", () => {
    bundle(join(".local", "share", "code-server", "extensions"), "2.1.220");
    const local = writeExecutable(join(".claude", "local"), "claude");
    expect(resolveClaudeBin()).toBe(local);
  });

  it("falls back to bare \"claude\" when nothing resolves", () => {
    expect(resolveClaudeBin()).toBe("claude");
  });
});
