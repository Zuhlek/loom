/**
 * tmux-availability.ts — one-shot probe + typed unavailable error.
 *
 * Boot-time: `probeTmux()` runs `tmux -V` once with `execFile`, captures
 * `{ available, version, versionError }`. Never throws. Used by
 * `index.ts` to log a single actionable line and to wire an
 * `availability` getter into `createTmuxSession`.
 *
 * Failure mode (M3 fix): tmux missing must NOT kill the server. The
 * server boots, routes mount, and the UI receives a typed
 * runtime-unavailable error frame on first chat attach (per
 * `quality-review.md`).
 */

import { execFile } from "node:child_process";

export interface TmuxProbeResult {
  available: boolean;
  /** The first line of `tmux -V` stdout when available, else null. */
  version: string | null;
  /** Single-line, actionable error string when unavailable; null otherwise. */
  versionError: string | null;
}

export interface ProbeTmuxOptions {
  /** Override the `tmux` binary path; defaults to `tmux` on PATH. */
  tmuxBin?: string;
}

/** Sentinel error type the bridge / WS layer pattern-matches on. */
export class TmuxUnavailableError extends Error {
  public readonly kind = "tmux-unavailable" as const;
  public readonly code = "ENOENT" as const;
  constructor(message: string) {
    super(message);
    this.name = "TmuxUnavailableError";
  }
}

const INSTALL_HINT = "Install tmux >= 3.0 and ensure it is on PATH — see docs/setup.md.";

function runVersionProbe(
  bin: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; errCode: string | null }> {
  return new Promise((resolve) => {
    execFile(bin, ["-V"], { env: process.env }, (err, stdout, stderr) => {
      if (err) {
        const errCode = String(
          (err as NodeJS.ErrnoException & { code?: unknown }).code ?? "",
        );
        resolve({
          ok: false,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          errCode: errCode || null,
        });
        return;
      }
      resolve({
        ok: true,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        errCode: null,
      });
    });
  });
}

/**
 * Probe for tmux availability. Never throws. Use the returned shape to
 * decide whether to wire `createTmuxSession({ availability: () => ... })`
 * with `available: false`.
 */
export async function probeTmux(
  opts: ProbeTmuxOptions = {},
): Promise<TmuxProbeResult> {
  const bin = opts.tmuxBin ?? "tmux";
  const result = await runVersionProbe(bin);
  if (result.ok) {
    const version = result.stdout.split("\n")[0]?.trim() || null;
    return { available: true, version, versionError: null };
  }
  // Build a single-line actionable error string. No embedded newlines.
  const reason =
    result.errCode === "ENOENT"
      ? "binary not found"
      : `probe failed (${result.errCode ?? "unknown error"})`;
  const versionError = `tmux: ${reason}. ${INSTALL_HINT}`.replace(/\s+/g, " ").trim();
  return { available: false, version: null, versionError };
}

/**
 * Build the boot stderr notice. Returns null when tmux is available
 * (no notice to print). Returns a single-line string otherwise — the
 * caller wraps it in a `[loom]` prefix and chooses warn vs error.
 */
export function formatTmuxUnavailableNotice(
  probe: TmuxProbeResult,
): string | null {
  if (probe.available) return null;
  // The notice MUST contain the install hint (with docs/setup.md
  // pointer) so the user has a single actionable line to follow.
  // `probeTmux` already attaches the hint to `versionError`, but a
  // hand-rolled caller may pass an unadorned message — defence in
  // depth, we append the hint if missing.
  let base = (probe.versionError ?? "tmux: unavailable.")
    .replace(/\s+/g, " ")
    .trim();
  if (!base.includes("docs/setup.md")) {
    base = `${base} ${INSTALL_HINT}`.replace(/\s+/g, " ").trim();
  }
  return base;
}
