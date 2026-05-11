/*
 * PTY — child-process manager for spawning claude (or any other PTY peer)
 * and bridging bytes through the WebSocket layer.
 *
 * We spawn a tiny node sidecar per chat that owns node-pty and
 * exchanges JSON line frames over stdin/stdout (see
 * apps/server/src/process-manager/pty-helper.cjs). The sidecar gives us
 * crash isolation — if node-pty or claude misbehaves, only the helper
 * dies, not the whole server. The exported `spawnPty` returns a
 * `PtyProcess` whose surface matches what the bridge expects, so callers
 * don't need to know about the helper.
 *
 * If `node` is not on PATH or node-pty fails to load, we fall back to
 * `child_process.spawn` (text-only — vt100 escapes are degraded but the
 * basic protocol still works).
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";

export interface PtyExitEvent {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals): void;
  onData(callback: (chunk: string) => void): () => void;
  onExit(callback: (evt: PtyExitEvent) => void): () => void;
}

export interface PtySpawnInput {
  /** Executable to run, e.g. "claude" or "/bin/bash". */
  shell: string;
  args?: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
}

export class PtySpawnError extends Error {
  constructor(message: string, readonly adapter: string, readonly cause?: unknown) {
    super(message);
    this.name = "PtySpawnError";
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = path.join(__dirname, "pty-helper.cjs");

class HelperBackedPty implements PtyProcess {
  pid = -1;
  private dataListeners = new Set<(chunk: string) => void>();
  private exitListeners = new Set<(evt: PtyExitEvent) => void>();
  private buffer = "";
  private exited = false;

  constructor(private proc: ChildProcessByStdio<Writable, Readable, Readable>) {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.handleChunk(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      // Helper errors go to its stderr — surface as text data.
      const text = chunk.toString("utf8");
      for (const listener of this.dataListeners) listener(`[pty-helper stderr] ${text}`);
    });
    proc.on("exit", (code, signal) => {
      if (this.exited) return;
      this.exited = true;
      const evt: PtyExitEvent = { exitCode: code ?? -1, signal };
      for (const listener of this.exitListeners) listener(evt);
    });
  }

  private handleChunk(chunk: string): void {
    this.buffer += chunk;
    let nl = this.buffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.handleLine(line);
      nl = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.kind === "started") {
      this.pid = msg.pid;
    } else if (msg.kind === "data") {
      const data: string = msg.data ?? "";
      for (const listener of this.dataListeners) listener(data);
    } else if (msg.kind === "exit") {
      this.exited = true;
      const evt: PtyExitEvent = { exitCode: msg.exitCode ?? -1, signal: msg.signal ?? null };
      for (const listener of this.exitListeners) listener(evt);
    } else if (msg.kind === "error") {
      for (const listener of this.dataListeners) listener(`[pty-helper] ${msg.message}\r\n`);
    }
  }

  write(data: string): void {
    if (!this.proc.stdin.writableEnded) {
      this.proc.stdin.write(JSON.stringify({ kind: "write", data }) + "\n");
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.proc.stdin.writableEnded) {
      this.proc.stdin.write(JSON.stringify({ kind: "resize", cols, rows }) + "\n");
    }
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.proc.stdin.writableEnded) {
      try {
        this.proc.stdin.write(JSON.stringify({ kind: "kill", signal }) + "\n");
      } catch {}
    }
    setTimeout(() => {
      if (!this.exited) {
        try {
          this.proc.kill(signal);
        } catch {}
      }
    }, 200);
  }

  onData(cb: (chunk: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (evt: PtyExitEvent) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}

class FallbackPty implements PtyProcess {
  private dataListeners = new Set<(chunk: string) => void>();
  private exitListeners = new Set<(evt: PtyExitEvent) => void>();
  readonly pid: number;

  constructor(private readonly proc: ChildProcessByStdio<Writable, Readable, Readable>) {
    this.pid = proc.pid ?? -1;
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      for (const listener of this.dataListeners) listener(text);
    });
    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      for (const listener of this.dataListeners) listener(text);
    });
    proc.on("exit", (code, signal) => {
      const evt: PtyExitEvent = { exitCode: code ?? -1, signal };
      for (const listener of this.exitListeners) listener(evt);
    });
  }

  write(data: string): void {
    if (!this.proc.stdin.writableEnded) this.proc.stdin.write(data);
  }

  resize(_cols: number, _rows: number): void {
    // no-op
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.proc.kill(signal);
  }

  onData(cb: (chunk: string) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (evt: PtyExitEvent) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }
}

function spawnViaHelper(input: PtySpawnInput): PtyProcess {
  const proc = spawn("node", [HELPER_PATH], {
    cwd: input.cwd,
    env: { ...(input.env ?? process.env), TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessByStdio<Writable, Readable, Readable>;

  if (!proc.pid) {
    throw new PtySpawnError("failed to spawn pty-helper", "node-helper");
  }
  // Send the start frame.
  proc.stdin.write(
    JSON.stringify({
      kind: "start",
      shell: input.shell,
      args: input.args ?? [],
      cwd: input.cwd,
      cols: input.cols ?? 100,
      rows: input.rows ?? 30,
    }) + "\n",
  );
  return new HelperBackedPty(proc);
}

function spawnDirectly(input: PtySpawnInput): PtyProcess {
  const proc = spawn(input.shell, input.args ?? [], {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessByStdio<Writable, Readable, Readable>;

  if (!proc.pid) {
    throw new PtySpawnError(`Failed to spawn ${input.shell}`, "child_process");
  }
  return new FallbackPty(proc);
}

/**
 * Spawn a process via the node-pty helper if available; fall back to
 * `child_process.spawn` otherwise.
 *
 * Tests can pass `useHelper: false` to bypass the helper (no node binary
 * required).
 */
export function spawnPty(input: PtySpawnInput & { useHelper?: boolean }): PtyProcess {
  // Helper requires a `node` binary on PATH. If we're calling out to /bin/echo
  // or a non-interactive shell, the fallback is fine; the helper is only worth
  // it for things like claude that detect TTY.
  const wantHelper = input.useHelper ?? true;
  if (wantHelper) {
    try {
      return spawnViaHelper(input);
    } catch (err) {
      // Fall through to direct spawn.
      console.warn(
        `[nora pty] helper failed (${(err as Error).message}); falling back to child_process`,
      );
    }
  }
  return spawnDirectly(input);
}
