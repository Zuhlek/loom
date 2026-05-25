/**
 * tmux-session.ts — the only path through which loom touches tmux.
 *
 * Design ADR-001 / ADR-002 (single tmux backend, ≥ 3.0 with literal-mode
 * send-keys). All shell-outs use `execFile` with argv arrays — never
 * string concatenation — so the literal-mode contract holds end-to-end.
 *
 * No drain timer. No idle reaper. No in-memory liveness map — `exists`
 * shells out to `tmux has-session` so the answer reflects tmux server
 * state across restarts (Design ADR-004 / ADR-007).
 */

import { buildClaudeSpawnEnv } from "./claude-env.ts";
import { execArgv, type ExecArgvResult } from "./exec-argv.ts";
import { TmuxUnavailableError } from "./tmux-availability.ts";

export interface TmuxSessionApi {
  /**
   * Idempotent. If `tmux has-session -t loom-<chatId>` succeeds, no-op.
   * Otherwise spawns
   *   tmux new-session -d -s loom-<chatId> -c <cwd> -- claude --session-id <sessionId>
   * with env built by `buildClaudeSpawnEnv(...)` from `claude-env.ts`.
   */
  ensure(chatId: string, cwd: string, sessionId: string): Promise<void>;

  /** `tmux kill-session -t loom-<chatId>`. Idempotent: missing session is a no-op. */
  kill(chatId: string): Promise<void>;

  /**
   * `tmux send-keys -t loom-<chatId> -l -- <text>`
   * then `tmux send-keys -t loom-<chatId> Enter`.
   * Literal-mode mandatory.
   */
  sendInput(chatId: string, text: string): Promise<void>;

  /** `tmux send-keys -t loom-<chatId> Escape`. */
  interrupt(chatId: string): Promise<void>;

  /** `tmux has-session -t loom-<chatId>`; returns boolean. Single source of truth. */
  exists(chatId: string): Promise<boolean>;
}

export interface TmuxSessionOptions {
  /** Override the `tmux` binary name (mostly for tests). */
  tmuxBin?: string;
  /** Override the `claude` binary name (mostly for tests / setup). */
  claudeBin?: string;
  /** Build the env passed to `tmux new-session`. */
  buildEnv?: () => NodeJS.ProcessEnv;
  /**
   * Runtime availability gate. When the getter returns
   * `{ available: false }`, mutating calls (`ensure`, `sendInput`,
   * `interrupt`) reject with `TmuxUnavailableError` without spawning
   * child processes. `exists` resolves `false`; `kill` resolves no-op.
   *
   * Re-read on every call so the boot-time probe result can be flipped
   * by a future re-probe surface without re-constructing the session.
   *
   * When omitted, behaviour is unchanged (default-available).
   */
  availability?: () => { available: boolean };
}

function targetFor(chatId: string): string {
  return `loom-${chatId}`;
}

/**
 * `execArgv` wrapper that promotes ENOENT (binary missing) into a
 * structural error — tmux subcommands return non-zero for many normal
 * conditions (`has-session`, `kill-session` for an absent target) so we
 * can't conflate "tmux binary missing" with "tmux said no". Non-zero
 * exit codes are surfaced as a structured result for the caller to
 * branch on.
 */
async function runTmux(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<ExecArgvResult> {
  const r = await execArgv(cmd, args, env);
  if (r.errnoCode === "ENOENT") {
    const wrapped = new Error(
      `tmux: binary not found (ENOENT). Install tmux >= 3.0 and ensure it is on PATH.`,
    );
    (wrapped as NodeJS.ErrnoException).code = "ENOENT";
    throw wrapped;
  }
  return r;
}

export function createTmuxSession(opts: TmuxSessionOptions = {}): TmuxSessionApi {
  const tmuxBin = opts.tmuxBin ?? "tmux";
  const claudeBin = opts.claudeBin ?? "claude";
  const buildEnv = opts.buildEnv ?? (() => buildClaudeSpawnEnv());
  const availability = opts.availability;

  function isAvailable(): boolean {
    if (!availability) return true;
    return availability().available;
  }

  function unavailableError(action: string): TmuxUnavailableError {
    return new TmuxUnavailableError(
      `tmux runtime unavailable; cannot ${action}. Install tmux >= 3.0.`,
    );
  }

  async function hasSession(chatId: string): Promise<boolean> {
    const r = await runTmux(
      tmuxBin,
      ["has-session", "-t", targetFor(chatId)],
      buildEnv(),
    );
    return r.code === 0;
  }

  return {
    async ensure(chatId, cwd, sessionId) {
      if (!isAvailable()) throw unavailableError("ensure session");
      if (await hasSession(chatId)) return;
      const args = [
        "new-session",
        "-d",
        "-s",
        targetFor(chatId),
        "-c",
        cwd,
        "--",
        claudeBin,
        "--session-id",
        sessionId,
      ];
      const r = await runTmux(tmuxBin, args, buildEnv());
      if (r.code !== 0) {
        throw new Error(
          `tmux: new-session failed (code ${r.code}) for chat ${chatId}. stderr: ${r.stderr}`,
        );
      }
    },

    async kill(chatId) {
      // When tmux is unavailable, the idempotent contract still holds —
      // there is nothing to kill. Skip the shell-out.
      if (!isAvailable()) return;
      // Idempotent: tmux returns non-zero when the session is absent; we
      // swallow that. Genuine permission / config errors still surface
      // because they manifest as ENOENT (handled in `runTmux`).
      await runTmux(
        tmuxBin,
        ["kill-session", "-t", targetFor(chatId)],
        buildEnv(),
      );
    },

    async sendInput(chatId, text) {
      if (!isAvailable()) throw unavailableError("send input");
      // The `-l --` combination is mandatory: -l = literal mode (no
      // key-name parsing), -- = end-of-flags so a leading-dash payload
      // does not look like a tmux flag. Two argv slots, each separate.
      const literal = await runTmux(
        tmuxBin,
        ["send-keys", "-t", targetFor(chatId), "-l", "--", text],
        buildEnv(),
      );
      if (literal.code !== 0) {
        throw new Error(
          `tmux: send-keys (literal) failed (code ${literal.code}) for chat ${chatId}.`,
        );
      }
      const enter = await runTmux(
        tmuxBin,
        ["send-keys", "-t", targetFor(chatId), "Enter"],
        buildEnv(),
      );
      if (enter.code !== 0) {
        throw new Error(
          `tmux: send-keys (Enter) failed (code ${enter.code}) for chat ${chatId}.`,
        );
      }
    },

    async interrupt(chatId) {
      if (!isAvailable()) throw unavailableError("interrupt");
      const r = await runTmux(
        tmuxBin,
        ["send-keys", "-t", targetFor(chatId), "Escape"],
        buildEnv(),
      );
      if (r.code !== 0) {
        throw new Error(
          `tmux: send-keys (Escape) failed (code ${r.code}) for chat ${chatId}.`,
        );
      }
    },

    async exists(chatId) {
      // When tmux is unavailable, no session can exist. Skip the
      // shell-out so we don't bubble ENOENT to callers that treat
      // `exists` as a read-only predicate.
      if (!isAvailable()) return false;
      return hasSession(chatId);
    },
  };
}
