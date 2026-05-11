/*
 * JSONL tailer — reads Claude Code's transcript files under
 * ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl and emits each
 * line as a parsed object.
 *
 * Used by the chat view to render the canonical Claude transcript
 * (T-012). Tail mode uses fs.watch for change notifications and
 * re-reads from the last seen offset.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";

export interface JsonlEntry {
  /** Whole parsed object — Claude Code transcripts have wide variety. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface JsonlTailerOptions {
  /** Debounce window for fs.watch coalescing, ms. */
  debounceMs?: number;
}

export class JsonlTailer extends EventEmitter {
  private offset = 0;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly filePath: string, private readonly opts: JsonlTailerOptions = {}) {
    super();
  }

  /**
   * Start tailing. Reads the existing file once, then watches for appends.
   * Each parsed line is emitted as `'entry'`.
   */
  async start(): Promise<void> {
    if (fs.existsSync(this.filePath)) {
      await this.readFromOffset();
    }
    this.attachWatcher();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.watcher?.close();
    this.watcher = null;
  }

  // We pair fs.watch (low-latency notifications) with a 200 ms polling
  // fallback. Node's fs.watch on macOS (FSEvents) can drop the first event
  // after a directory is freshly created, and is unreliable when watching a
  // single file rather than its parent directory. Polling guarantees we
  // converge regardless.
  private attachWatcher(): void {
    if (this.watcher) return;
    const parent = path.dirname(this.filePath);
    if (fs.existsSync(parent)) {
      const target = path.basename(this.filePath);
      this.watcher = fs.watch(parent, { persistent: false }, (_evt, filename) => {
        if (!filename) return;
        if (filename.toString() !== target) return;
        this.onChange();
      });
    }
    this.pollTimer = setInterval(() => this.onChange(), 200);
    this.pollTimer.unref?.();
  }

  private onChange(): void {
    if (this.stopped) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.readFromOffset().catch((e) => this.emit("error", e));
    }, this.opts.debounceMs ?? 200);
  }

  private async readFromOffset(): Promise<void> {
    const stat = fs.statSync(this.filePath);
    if (stat.size <= this.offset) return;
    const stream = fs.createReadStream(this.filePath, { start: this.offset, end: stat.size - 1 });
    let buf = "";
    for await (const chunk of stream) {
      buf += chunk.toString();
      let idx = buf.indexOf("\n");
      while (idx !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) this.emitParsed(line);
        idx = buf.indexOf("\n");
      }
    }
    if (buf) this.emitParsed(buf);
    this.offset = stat.size;
  }

  private emitParsed(line: string): void {
    try {
      this.emit("entry", JSON.parse(line) as JsonlEntry);
    } catch (e) {
      this.emit("error", new Error(`JSONL parse error: ${(e as Error).message} — ${line.slice(0, 120)}`));
    }
  }
}

/**
 * Encode a cwd into Claude Code's projects-directory naming scheme.
 * Claude Code maps every slash (including the leading one) to a hyphen,
 * so `/Users/foo` becomes `-Users-foo` and lives at
 * `~/.claude/projects/-Users-foo/`.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/\\]/g, "-");
}

/** Path to the Claude Code transcripts directory for `cwd`. */
export function transcriptsDir(cwd: string, claudeHome = path.join(process.env.HOME ?? "", ".claude")): string {
  return path.join(claudeHome, "projects", encodeProjectDir(cwd));
}
