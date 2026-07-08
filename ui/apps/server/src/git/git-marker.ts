import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Probe for a `.git` marker (directory or gitfile) at `dir`, keeping a
 * confirmed absence distinct from an indeterminate filesystem error.
 *
 * `fs.existsSync` collapses every failure to `false`, conflating "no repo
 * here" (ENOENT) with a transient I/O fault. On network / VM mounts (e.g.
 * AppleVirtIOFS) an EIO would otherwise be misread as "not a git repo" and
 * get cached and persisted — sticking the workspace pill on "no git" long
 * after the mount recovers. Callers walking up the tree keep walking on
 * "absent" but must stop guessing on "error".
 */
export type GitMarker = "present" | "absent" | "error";

export function probeGitMarker(dir: string): GitMarker {
  try {
    fs.statSync(path.join(dir, ".git"));
    return "present";
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "error";
  }
}
