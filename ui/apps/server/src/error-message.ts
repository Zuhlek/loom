// Canonical exception → user-facing string for every server-side error
// surface (route JSON `{ error }`, ws error frames). One formatter so
// messages read consistently and git plumbing never leaks to the UI.
import { GitCommandError } from "./git/worktree.ts";

export function errorMessage(e: unknown): string {
  if (e instanceof GitCommandError) {
    // GitCommandError.message embeds "git <args> exited N: <full stderr>" —
    // developer-facing plumbing. Strip the prefix and git's `hint:` spam,
    // then surface the real rejection/error line so the UI reads cleanly
    // (e.g. "! [rejected] master -> master (fetch first)").
    // ponytail: heuristic stderr pick, add explicit git-error→message
    // mapping when a real case reads badly.
    const lines = e.stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("hint:"));
    const meaningful = lines.find((l) => /rejected|error:|fatal:/i.test(l));
    return meaningful ?? lines[0] ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
