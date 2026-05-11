/**
 * Single-instance lockfile for nora-server.
 *
 * Writes ~/.nora/.lock containing the current PID. If a lock already
 * exists and the PID is alive, refuses cleanly. Releases on
 * process exit / SIGTERM.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface LockResult {
  ok: boolean;
  reason?: "already-running" | "stale-takeover" | "io-error";
  pid?: number;
  message?: string;
  release?: () => void;
}

const DEFAULT_LOCK_PATH = path.join(os.homedir(), ".nora", ".lock");

function isPidAlive(pid: number): boolean {
  try {
    // Sending signal 0 is a no-op signal-existence probe.
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH: no such process. EPERM: process exists but owned by
    // another user — almost certainly NOT our recycled nora-server, so
    // treat as stale and let the caller take the lock. Anything else
    // (e.g. invalid PID) → treat as dead.
    return false;
  }
}

export function acquireLock(lockPath: string = DEFAULT_LOCK_PATH): LockResult {
  const dir = path.dirname(lockPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    // ignore — open will fail next if it really can't write
  }

  // Check existing lock.
  if (fs.existsSync(lockPath)) {
    let existing: number | null = null;
    try {
      const raw = fs.readFileSync(lockPath, "utf8").trim();
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) existing = parsed;
    } catch {}

    if (existing !== null && existing !== process.pid && isPidAlive(existing)) {
      return {
        ok: false,
        reason: "already-running",
        pid: existing,
        message: `nora-server already running at PID ${existing}`,
      };
    }
    // Stale lock (dead PID, unparseable contents, or our own PID from a
    // crashed prior run) — delete it and fall through to acquire fresh.
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid), { encoding: "utf8" });
  } catch (err: any) {
    return { ok: false, reason: "io-error", message: err.message };
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Idempotent: delete the file if it's still ours. If it's gone,
    // owned by another PID, or unreadable, do nothing.
    try {
      if (!fs.existsSync(lockPath)) return;
      let stillOurs = true;
      try {
        const raw = fs.readFileSync(lockPath, "utf8").trim();
        const parsed = parseInt(raw, 10);
        // If parsing fails, the file is junk — clear it. If a different
        // PID owns it, another nora-server claimed it after us; leave
        // it alone.
        if (!isNaN(parsed) && parsed > 0 && parsed !== process.pid) {
          stillOurs = false;
        }
      } catch {
        // If we can't read it, fall through to delete — safer to clear
        // an unreadable lock than to leak it.
      }
      if (stillOurs) {
        try {
          fs.unlinkSync(lockPath);
        } catch {}
      }
    } catch {}
  };

  // Best-effort auto-release on exit and signals. `exit` fires
  // synchronously so it covers normal termination; SIGINT/SIGTERM
  // release first then re-exit so any other handlers also run.
  process.once("exit", () => release());
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });

  return { ok: true, pid: process.pid, release };
}

export const __lockfile_default_path = DEFAULT_LOCK_PATH;
