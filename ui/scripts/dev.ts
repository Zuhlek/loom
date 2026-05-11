/**
 * Concurrent dev script.
 *
 * Spawns nora-server (Bun watch) and the Vite dev server side-by-side,
 * pipes their stdout/stderr with a label prefix, and forwards SIGINT /
 * SIGTERM to both children so Ctrl+C cleanly stops everything.
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

interface ChildSpec {
  label: string;
  color: string;
  cmd: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

const RESET = "\x1b[0m";

function paint(color: string, text: string): string {
  return `${color}${text}${RESET}`;
}

function startChild(spec: ChildSpec): ChildProcess {
  const proc = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tag = paint(spec.color, `[${spec.label}]`);

  const writeLines = (stream: NodeJS.WritableStream, label: string) => (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      stream.write(`${tag} ${line}\n`);
    }
  };

  proc.stdout?.on("data", writeLines(process.stdout, spec.label));
  proc.stderr?.on("data", writeLines(process.stderr, spec.label));

  proc.on("exit", (code, signal) => {
    process.stdout.write(`${tag} exited code=${code} signal=${signal ?? "-"}\n`);
  });

  return proc;
}

const children: ChildProcess[] = [];

function shutdown(signal: NodeJS.Signals): void {
  process.stdout.write(`\n[dev] received ${signal}, shutting down children...\n`);
  for (const c of children) {
    if (!c.killed) {
      try {
        c.kill(signal);
      } catch {}
    }
  }
  // Give children a moment, then exit.
  setTimeout(() => process.exit(0), 600).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const server = startChild({
  label: "server",
  color: "\x1b[36m", // cyan
  cmd: "bun",
  args: ["run", "--watch", "apps/server/src/index.ts"],
  cwd: repoRoot,
  env: { NORA_PORT: process.env.NORA_PORT ?? "3737" },
});
children.push(server);

const web = startChild({
  label: "web",
  color: "\x1b[35m", // magenta
  cmd: "bun",
  args: ["run", "vite"],
  cwd: path.join(repoRoot, "apps/web"),
});
children.push(web);

process.stdout.write(
  "[dev] starting: server (port 3737) and web (port 5173). Open http://localhost:5173.\n",
);
