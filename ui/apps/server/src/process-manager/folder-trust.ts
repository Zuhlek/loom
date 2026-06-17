/**
 * folder-trust.ts — pre-seed claude's per-folder trust so a
 * `--dangerously-skip-permissions` ("Full access") spawn does NOT block
 * on claude's interactive "Is this a project you trust?" dialog.
 *
 * Why this exists. claude refuses to skip permissions in a folder the
 * user has not explicitly trusted: on first launch in an untrusted
 * directory it shows a blocking trust dialog ("❯ 1. Yes, I trust this
 * folder"). loom drives claude headlessly via tmux `send-keys`, so a
 * first turn queued during cold-start is typed straight INTO that dialog
 * — the literal text is swallowed by the list widget and the trailing
 * Enter accidentally accepts "Yes". The user's turn never becomes a turn,
 * no JSONL echo is written, and the chat hangs until the UI's watchdog
 * flips the optimistic bubble to "failed to send". Only bypass mode hits
 * this; the other permission modes boot straight to the REPL.
 *
 * Creating a loom chat at a path with Full access IS an explicit trust
 * decision — the spawn dialog states the local environment is the trust
 * boundary — so loom records that trust in ~/.claude.json before spawning,
 * exactly as claude itself would after the user clicked "Yes". claude keys
 * trust by the REALPATH of the cwd (it canonicalises symlinks such as
 * macOS `/tmp` → `/private/tmp`), so we resolve before writing.
 *
 * Best-effort and atomic (tmp + rename). A missing config is created; a
 * malformed / unreadable / unexpectedly-shaped config is left untouched so
 * we never corrupt claude's own file — the worst case is claude shows its
 * trust dialog, i.e. today's behaviour.
 */

import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface EnsureFolderTrustedOptions {
  /** Override the claude config path. Default `~/.claude.json`. */
  configPath?: string;
  /**
   * Override realpath resolution (tests). Production resolves symlinks via
   * `fs.realpathSync` to match how claude keys its trust map.
   */
  resolvePath?: (p: string) => string;
}

function defaultConfigPath(): string {
  return join(homedir(), ".claude.json");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Ensure `projects[realpath(cwd)].hasTrustDialogAccepted === true` in
 * claude's config. Idempotent — a no-op when trust is already recorded
 * (so it neither churns the file nor races claude's own writes). Returns
 * `true` iff a write actually happened.
 */
export function ensureFolderTrusted(
  cwd: string,
  opts: EnsureFolderTrustedOptions = {},
): boolean {
  const configPath = opts.configPath ?? defaultConfigPath();
  const resolve =
    opts.resolvePath ??
    ((p) => {
      try {
        return realpathSync(p);
      } catch {
        // Dir not yet resolvable (e.g. about to be created) — fall back to
        // the path as given; claude will canonicalise an existing dir.
        return p;
      }
    });
  const key = resolve(cwd);

  let config: Record<string, unknown> = {};
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      // Unexpected top-level shape — do not clobber claude's file.
      return false;
    }
    config = parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Unreadable or malformed JSON — leave it alone.
      return false;
    }
    // ENOENT: start from an empty config and create the file below.
  }

  const projects = isPlainObject(config.projects) ? config.projects : {};
  const existing = projects[key];
  const entry: Record<string, unknown> = isPlainObject(existing) ? existing : {};

  if (entry.hasTrustDialogAccepted === true) {
    return false; // already trusted.
  }

  entry.hasTrustDialogAccepted = true;
  projects[key] = entry;
  config.projects = projects;

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    const tmp = `${configPath}.loom-tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
    renameSync(tmp, configPath);
    return true;
  } catch {
    return false; // best-effort: never throw into the spawn path.
  }
}
