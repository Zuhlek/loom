/**
 * pane-process.ts — file-ownership identity check anchored on the tmux
 * pane PID.
 *
 * Used by `jsonl/bridge.ts` to distinguish legitimate claude session-id
 * rotation (a new `.jsonl` file appearing in the encoded-cwd directory
 * written by OUR claude process) from bystander claude sessions writing
 * in the same encoded-cwd directory (e.g. the user running `claude`
 * directly in their terminal in the same project). Per ADR-007 the
 * tmux pane is the single source of truth for "what process tree
 * belongs to this loom chat"; we resolve the pane root PID, ask `lsof`
 * which processes hold the candidate JSONL open, and walk each
 * writer's ppid chain looking for the pane PID.
 *
 * All shell-outs use `execFile` with argv arrays (ADR-001 literal-mode
 * discipline; see `tmux-session.ts`). No string concatenation, no
 * `exec`. Works identically on Linux and macOS — `lsof -F` machine-
 * parsable output is portable, `ps -o ppid= -p <pid>` is POSIX.
 *
 * Fail-closed: any error (lsof absent, parse failure, process gone)
 * returns `false` from `paneOwnsFile` so a bystander candidate is
 * dropped rather than adopted. The single exception is `lsof` ENOENT —
 * if the binary is missing entirely we degrade to the kill-switch
 * semantics (return `true`) and log once, because otherwise the bridge
 * would never adopt any rotation on a system without lsof installed.
 */

import { execFile } from "node:child_process";

export interface PaneProcessApi {
  /** tmux list-panes -t loom-<chatId> -F '#{pane_pid}'. Returns null if no pane. */
  paneRootPid(chatId: string): Promise<number | null>;
  /**
   * True iff some process with `path` open has `ancestorPid` in its ppid chain
   * (or IS `ancestorPid`). False on lsof absence, ENOENT, or any error — fail-closed.
   */
  paneOwnsFile(ancestorPid: number, path: string): Promise<boolean>;
}

export interface PaneProcessOptions {
  tmuxBin?: string;
  lsofBin?: string;
  psBin?: string;
  /** Env-var kill switch. When LOOM_DISABLE_PANE_PID_GATE=1, paneOwnsFile always returns true. */
  disabledByEnv?: () => boolean;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  errnoCode?: string;
}

function runArgv(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) {
        const errnoCode = (err as NodeJS.ErrnoException).code;
        const numCode =
          typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((err as unknown as { code: number }).code)
            : 1;
        resolve({
          code: numCode,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          errnoCode: typeof errnoCode === "string" ? errnoCode : undefined,
        });
        return;
      }
      resolve({ code: 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function paneTargetFor(chatId: string): string {
  return `loom-${chatId}`;
}

const PPID_DEPTH_CAP = 32;

export function createPaneProcessApi(opts: PaneProcessOptions = {}): PaneProcessApi {
  const tmuxBin = opts.tmuxBin ?? "tmux";
  const lsofBin = opts.lsofBin ?? "lsof";
  const psBin = opts.psBin ?? "ps";
  const disabledByEnv =
    opts.disabledByEnv ??
    (() => process.env.LOOM_DISABLE_PANE_PID_GATE === "1");

  let killSwitchLogged = false;
  let lsofMissingLogged = false;

  return {
    async paneRootPid(chatId) {
      const r = await runArgv(tmuxBin, [
        "list-panes",
        "-t",
        paneTargetFor(chatId),
        "-F",
        "#{pane_pid}",
      ]);
      if (r.code !== 0) return null;
      const firstLine = r.stdout.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
      if (!firstLine) return null;
      const n = parseInt(firstLine, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      return n;
    },

    async paneOwnsFile(ancestorPid, path) {
      if (disabledByEnv()) {
        if (!killSwitchLogged) {
          killSwitchLogged = true;
          console.warn(
            "[loom] LOOM_DISABLE_PANE_PID_GATE=1; pane-pid file-ownership check disabled (all rotation candidates accepted).",
          );
        }
        return true;
      }

      const lsof = await runArgv(lsofBin, ["-nP", "-Fpn", "--", path]);
      if (lsof.errnoCode === "ENOENT") {
        if (!lsofMissingLogged) {
          lsofMissingLogged = true;
          console.warn(
            "[loom] lsof binary not found on PATH; pane-pid file-ownership check degraded to allow-all. Install lsof to enable bystander-resistance.",
          );
        }
        return true;
      }
      if (lsof.code !== 0) return false;

      const writers = parseLsofPnHolders(lsof.stdout, path);
      if (writers.size === 0) return false;

      const ppidCache = new Map<number, number | null>();
      for (const pid of writers) {
        if (await chainHas(pid, ancestorPid, ppidCache, psBin)) return true;
      }
      return false;
    },
  };
}

/**
 * Parse `lsof -F pn` output: alternating `p<pid>` and `n<path>` lines.
 * Returns the set of PIDs whose `n` field matches `targetPath` exactly.
 * The path filter is redundant given we pass `-- <path>` to lsof, but
 * lsof may also list mmap'd or working-dir entries; gating on exact
 * path match keeps the writer set tight.
 */
function parseLsofPnHolders(stdout: string, targetPath: string): Set<number> {
  const pids = new Set<number>();
  let currentPid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const tag = line.charCodeAt(0);
    const rest = line.slice(1);
    if (tag === 0x70 /* 'p' */) {
      const n = parseInt(rest, 10);
      currentPid = Number.isFinite(n) && n > 0 ? n : null;
    } else if (tag === 0x6e /* 'n' */) {
      if (currentPid !== null && rest === targetPath) {
        pids.add(currentPid);
      }
    }
  }
  return pids;
}

async function chainHas(
  startPid: number,
  ancestorPid: number,
  cache: Map<number, number | null>,
  psBin: string,
): Promise<boolean> {
  let cur: number = startPid;
  for (let depth = 0; depth < PPID_DEPTH_CAP; depth++) {
    if (cur === ancestorPid) return true;
    if (cur <= 1) return false;
    let parent = cache.get(cur);
    if (parent === undefined) {
      parent = await readPpid(cur, psBin);
      cache.set(cur, parent);
    }
    if (parent === null) return false;
    cur = parent;
  }
  return false;
}

async function readPpid(pid: number, psBin: string): Promise<number | null> {
  const r = await runArgv(psBin, ["-o", "ppid=", "-p", String(pid)]);
  if (r.code !== 0) return null;
  const trimmed = r.stdout.trim();
  if (trimmed.length === 0) return null;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
