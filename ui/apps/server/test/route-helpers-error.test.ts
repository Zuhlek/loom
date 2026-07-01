import { describe, expect, test } from "vitest";

import { errorMessage } from "../src/routes/_route-helpers.ts";
import { GitCommandError } from "../src/git/worktree.ts";

describe("errorMessage — GitCommandError cleanup", () => {
  test("surfaces the rejection line, drops the git-plumbing prefix and hint spam", () => {
    const stderr = [
      "To github.com:foo/bar.git",
      " ! [rejected]        master -> master (fetch first)",
      "error: failed to push some refs to 'github.com:foo/bar.git'",
      "hint: Updates were rejected because the remote contains work that you do",
      "hint: not have locally. This is usually caused by another repository pushing",
    ].join("\n");
    const e = new GitCommandError(
      `git push -u origin master exited 1: ${stderr}`,
      1,
      stderr,
      ["push", "-u", "origin", "master"],
    );
    const msg = errorMessage(e);
    expect(msg).toBe("! [rejected]        master -> master (fetch first)");
    expect(msg).not.toContain("exited 1");
    expect(msg).not.toContain("hint:");
  });

  test("falls back to the first stderr line when nothing matches", () => {
    const e = new GitCommandError("git status exited 1: something odd", 1, "something odd", ["status"]);
    expect(errorMessage(e)).toBe("something odd");
  });

  test("plain Error passes through its message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});
