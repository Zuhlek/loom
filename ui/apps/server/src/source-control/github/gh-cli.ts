// Thin `gh` CLI wrapper — single IO seam for the GitHub provider.
import { spawn } from "node:child_process";

export interface RunGhOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function runGh(args: readonly string[], options: RunGhOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<string>((resolve, reject) => {
    const proc = spawn("gh", args.slice(), {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (stderr += d.toString("utf8")));
    if (options.stdin) {
      proc.stdin?.write(options.stdin);
      proc.stdin?.end();
    }
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`gh ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`gh ${args.join(" ")} failed: ${e.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`gh ${args.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}
