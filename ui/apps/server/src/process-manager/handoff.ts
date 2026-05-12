/**
 * Handoff launcher — opens a system terminal that re-attaches to a
 * chat's PTY session. The underlying bridge session is never killed;
 * the new terminal runs `loom attach <chatId>` (or the printable
 * fallback command) and resumes via the SDK's `resume:` path.
 *
 * Per ADR-005:
 *   - macOS: `open -a Terminal.app -n --args bash -lc "loom attach <id>"`.
 *   - Linux: try gnome-terminal → konsole → x-terminal-emulator → xterm
 *     (first-hit wins via `which`).
 *   - Windows: return { ok: false, error } without spawning anything.
 *
 * The `spawn` and `which` deps are injectable for unit tests.
 */
import { spawn as childSpawn } from "node:child_process";
import { execFileSync } from "node:child_process";

export interface HandoffSession {
  chatId: string;
  /** Optional — printed into the re-attach hint when present. */
  port?: number;
}

export interface HandoffResult {
  ok: boolean;
  error?: string;
  launched?: { command: string; pid: number };
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: { detached?: boolean; stdio?: any },
) => { pid?: number; unref(): void };

export type WhichFn = (cmd: string) => string | null;

export interface LaunchHandoffOptions {
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  which?: WhichFn;
}

const LINUX_TERMINAL_CHAIN = [
  "gnome-terminal",
  "konsole",
  "x-terminal-emulator",
  "xterm",
] as const;

function defaultWhich(cmd: string): string | null {
  try {
    const out = execFileSync("/usr/bin/env", ["which", cmd], { stdio: ["ignore", "pipe", "ignore"] });
    const path = out.toString().trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

function attachCommand(chatId: string): string {
  return `loom attach ${chatId}`;
}

export async function launchHandoffTerminal(
  session: HandoffSession,
  opts: LaunchHandoffOptions = {},
): Promise<HandoffResult> {
  const platform = opts.platform ?? process.platform;
  const spawn = opts.spawn ?? (childSpawn as unknown as SpawnFn);
  const which = opts.which ?? defaultWhich;
  const cmd = attachCommand(session.chatId);

  if (platform === "darwin") {
    const args = ["-a", "Terminal.app", "-n", "--args", "bash", "-lc", cmd];
    const child = spawn("open", args, { detached: true, stdio: "ignore" });
    child.unref?.();
    return {
      ok: true,
      launched: {
        command: `open ${args.join(" ")}`,
        pid: child.pid ?? 0,
      },
    };
  }

  if (platform === "linux") {
    for (const term of LINUX_TERMINAL_CHAIN) {
      if (which(term)) {
        const child = spawn(term, ["-e", "bash", "-lc", cmd], { detached: true, stdio: "ignore" });
        child.unref?.();
        return {
          ok: true,
          launched: { command: `${term} -e bash -lc "${cmd}"`, pid: child.pid ?? 0 },
        };
      }
    }
    return {
      ok: false,
      error:
        "No supported terminal emulator found. Install one of: " +
        LINUX_TERMINAL_CHAIN.join(", "),
    };
  }

  if (platform === "win32") {
    return {
      ok: false,
      error: "Windows is not supported for handoff in v1.",
    };
  }

  return { ok: false, error: `Unsupported platform: ${platform}` };
}
