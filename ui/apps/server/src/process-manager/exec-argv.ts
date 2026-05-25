/**
 * exec-argv.ts — shared `execFile` wrapper used by every loom process-manager
 * shell-out (tmux-session, pane-process). Always uses argv arrays — never
 * string concatenation — so ADR-001 literal-mode discipline holds end-to-end.
 *
 * Always RESOLVES (never rejects). Errno-style failures surface in
 * `errnoCode` so callers can distinguish "binary missing" (ENOENT) from
 * "command exited non-zero" without try/catch.
 */

import { execFile } from "node:child_process";

export interface ExecArgvResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Present when the call failed with an errno-style error (ENOENT, EACCES, ...). */
  errnoCode?: string;
}

export function execArgv(
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<ExecArgvResult> {
  return new Promise((resolve) => {
    const cb = (
      err: NodeJS.ErrnoException | null,
      stdout?: string | Buffer,
      stderr?: string | Buffer,
    ) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
        const numCode = typeof code === "number" ? code : 1;
        resolve({
          code: numCode,
          stdout: typeof stdout === "string" ? stdout : (stdout?.toString() ?? ""),
          stderr: typeof stderr === "string" ? stderr : (stderr?.toString() ?? ""),
          errnoCode: typeof code === "string" ? code : undefined,
        });
        return;
      }
      resolve({
        code: 0,
        stdout: typeof stdout === "string" ? stdout : (stdout?.toString() ?? ""),
        stderr: typeof stderr === "string" ? stderr : (stderr?.toString() ?? ""),
      });
    };
    // Pass `options` only when env is provided so test mocks that match
    // the 3-argument form (cmd, args, cb) keep working.
    if (env) {
      execFile(cmd, args, { env }, cb);
    } else {
      execFile(cmd, args, cb);
    }
  });
}
