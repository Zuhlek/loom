/*
 * Transcript watcher — tails the Claude Code JSONL transcript for a chat
 * (~/.claude/projects/<encoded-cwd>/<session-id>.jsonl) and surfaces the
 * task list as a fan-out for the chat's right-side TASKS panel.
 *
 * Claude Code ships two task-tracking shapes; we handle both:
 *
 *   1. TodoWrite (older) — a single tool_use whose `input.todos` is the
 *      full ordered task list. Each TodoWrite supersedes the prior one,
 *      so we replace state wholesale.
 *
 *   2. TaskCreate / TaskUpdate (Claude Code ≥ 2.1.x) — incremental.
 *      TaskCreate's tool_use carries `{subject, description, activeForm}`;
 *      the matching `tool_result` echoes back the auto-assigned id under
 *      `toolUseResult.task.id`. TaskUpdate carries `{taskId, status}`
 *      (and may carry other field updates) and patches an existing row.
 *
 * Wire-up: ChatPtyBridge owns one watcher per active chat. The watcher
 * starts when the first client attaches and stops when the chat session
 * is torn down. Updates fan out via the bridge's `onTasksUpdate`
 * listeners, which the WS server forwards to clients as
 * `{kind: "tasks-update", "chat-id": <id>, body: {tasks: [...]}}`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { JsonlTailer, transcriptsDir } from "./jsonl-tailer.ts";

/** A single task row as the frontend renders it. */
export interface Task {
  step: string;
  status: TaskStatus;
  activeForm?: string;
}

export type TaskStatus = "pending" | "inProgress" | "completed";

/**
 * Extract the todos array from a single JSONL line, if the line is a
 * TodoWrite tool_use. Returns `null` for anything else (regular
 * messages, other tool calls, user input, malformed JSON).
 *
 * Exported separately so the bridge unit tests can exercise the parser
 * without spinning up a tailer. Note this only covers the *old*
 * TodoWrite shape — the incremental TaskCreate/TaskUpdate shape needs
 * cross-line state and lives on the watcher itself.
 */
export function extractTodosFromJsonlLine(line: string): Task[] | null {
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return extractTodosFromJsonlEntry(parsed);
}

/**
 * Same as `extractTodosFromJsonlLine` but accepts an already-parsed
 * object — used by the tailer hot path so we don't re-parse.
 */
export function extractTodosFromJsonlEntry(entry: any): Task[] | null {
  if (!entry || typeof entry !== "object") return null;
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return null;
  // A single assistant turn can include several tool_use blocks; the
  // last TodoWrite in the turn wins.
  let latest: any = null;
  for (const item of content) {
    if (item && item.type === "tool_use" && item.name === "TodoWrite") {
      latest = item;
    }
  }
  if (!latest) return null;
  const todos = latest?.input?.todos;
  if (!Array.isArray(todos)) return null;
  const out: Task[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const step = typeof t.content === "string" ? t.content : "";
    if (!step) continue;
    const status = normaliseStatus(t.status);
    const task: Task = { step, status };
    if (typeof t.activeForm === "string" && t.activeForm.length > 0) {
      task.activeForm = t.activeForm;
    }
    out.push(task);
  }
  return out;
}

function normaliseStatus(raw: unknown): TaskStatus {
  if (raw === "in_progress" || raw === "inProgress") return "inProgress";
  if (raw === "completed") return "completed";
  return "pending";
}

export interface TranscriptWatcherOptions {
  /** Override the JSONL file path (tests). Defaults to the Claude Code path. */
  filePath?: string;
  /** Override the Claude home dir (tests). Defaults to `~/.claude`. */
  claudeHome?: string;
  /** Tailer debounce in ms. Defaults to 200. */
  debounceMs?: number;
}

/** Internal task row; carries the Claude-assigned id for TaskUpdate routing. */
interface TaskRow extends Task {
  id: string;
}

/** Buffered TaskCreate tool_use awaiting its tool_result for id assignment. */
interface PendingCreate {
  step: string;
  activeForm?: string;
}

/**
 * Tails the transcript file for `sessionId` under `cwd` and emits
 * `tasks` (a `Task[]`) every time the task list changes. Listeners get
 * the **full** latest list, not a diff.
 */
export class TranscriptWatcher extends EventEmitter {
  private tailer: JsonlTailer | null = null;
  private latestTasks: Task[] | null = null;
  private rowsById = new Map<string, TaskRow>();
  private rowOrder: string[] = [];
  private pendingCreates = new Map<string, PendingCreate>();

  constructor(
    private readonly sessionId: string,
    private readonly cwd: string,
    private readonly opts: TranscriptWatcherOptions = {},
  ) {
    super();
  }

  /** Resolved path of the JSONL file we're tailing. */
  get filePath(): string {
    if (this.opts.filePath) return this.opts.filePath;
    const dir = transcriptsDir(this.cwd, this.opts.claudeHome);
    return path.join(dir, `${this.sessionId}.jsonl`);
  }

  /** The latest extracted task list, or `null` if nothing seen yet. */
  getLatestTasks(): Task[] | null {
    return this.latestTasks;
  }

  async start(): Promise<void> {
    if (this.tailer) return;
    const file = this.filePath;
    // Ensure the parent directory exists so the tailer's parent-watcher
    // path works on first-spawn (claude creates it lazily).
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {}
    const tailer = new JsonlTailer(file, { debounceMs: this.opts.debounceMs ?? 200 });
    tailer.on("entry", (entry) => this.processEntry(entry));
    tailer.on("error", (err) => {
      // Surface but don't crash — partial / malformed lines happen
      // mid-write and are typically followed by a corrected re-flush.
      this.emit("error", err);
    });
    this.tailer = tailer;
    await tailer.start();
  }

  stop(): void {
    this.tailer?.stop();
    this.tailer = null;
  }

  /**
   * Apply a single parsed JSONL entry. Updates the internal row map and
   * emits `tasks` if the visible list changed.
   *
   * Handles three flavours:
   *   - TodoWrite tool_use → wholesale replace.
   *   - TaskCreate tool_use → buffer; tool_result later carries the id.
   *   - TaskCreate tool_result → realise the buffered create as a row.
   *   - TaskUpdate tool_use → mutate the matching row's status / fields.
   */
  private processEntry(entry: any): void {
    if (!entry || typeof entry !== "object") return;

    // 1. TodoWrite — full-snapshot path. Reset state to match.
    const todos = extractTodosFromJsonlEntry(entry);
    if (todos !== null) {
      this.resetFromTodoWrite(todos);
      this.emitIfChanged();
      return;
    }

    // 2. tool_use blocks (TaskCreate / TaskUpdate).
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      let mutated = false;
      for (const item of content) {
        if (!item || item.type !== "tool_use") continue;
        if (item.name === "TaskCreate") {
          this.bufferTaskCreate(item);
        } else if (item.name === "TaskUpdate") {
          if (this.applyTaskUpdate(item)) mutated = true;
        }
      }
      if (mutated) this.emitIfChanged();
    }

    // 3. tool_result for a buffered TaskCreate.
    if (Array.isArray(content) && entry?.type === "user") {
      let mutated = false;
      for (const item of content) {
        if (!item || item.type !== "tool_result") continue;
        const id = item.tool_use_id;
        if (typeof id !== "string") continue;
        const pending = this.pendingCreates.get(id);
        if (!pending) continue;
        const taskId = entry?.toolUseResult?.task?.id;
        if (taskId == null) {
          // Result arrived but didn't carry an id; drop the buffer.
          this.pendingCreates.delete(id);
          continue;
        }
        this.pendingCreates.delete(id);
        this.upsertRow({
          id: String(taskId),
          step: pending.step,
          status: "pending",
          activeForm: pending.activeForm,
        });
        mutated = true;
      }
      if (mutated) this.emitIfChanged();
    }
  }

  private resetFromTodoWrite(tasks: Task[]): void {
    this.rowsById.clear();
    this.rowOrder = [];
    this.pendingCreates.clear();
    // Synthesize ids so future TaskUpdates from a co-existing path could
    // still address rows by index — but since TodoWrite supersedes, the
    // ids never need to leak out. Keep them deterministic anyway.
    tasks.forEach((t, idx) => {
      const id = `todo:${idx}`;
      const row: TaskRow = { id, step: t.step, status: t.status };
      if (t.activeForm) row.activeForm = t.activeForm;
      this.rowsById.set(id, row);
      this.rowOrder.push(id);
    });
  }

  private bufferTaskCreate(toolUse: any): void {
    const useId = toolUse?.id;
    if (typeof useId !== "string") return;
    const input = toolUse?.input ?? {};
    const step = typeof input.subject === "string" ? input.subject : "";
    if (!step) return;
    const pending: PendingCreate = { step };
    if (typeof input.activeForm === "string" && input.activeForm.length > 0) {
      pending.activeForm = input.activeForm;
    }
    this.pendingCreates.set(useId, pending);
  }

  private applyTaskUpdate(toolUse: any): boolean {
    const input = toolUse?.input ?? {};
    const taskId = input.taskId;
    if (taskId == null) return false;
    const key = String(taskId);
    const row = this.rowsById.get(key);
    if (!row) return false;
    let changed = false;
    if (typeof input.status === "string") {
      const next = normaliseStatus(input.status);
      if (next !== row.status) {
        row.status = next;
        changed = true;
      }
    }
    if (typeof input.subject === "string" && input.subject !== row.step) {
      row.step = input.subject;
      changed = true;
    }
    if (typeof input.activeForm === "string" && input.activeForm !== row.activeForm) {
      row.activeForm = input.activeForm;
      changed = true;
    }
    return changed;
  }

  private upsertRow(row: TaskRow): void {
    if (!this.rowsById.has(row.id)) {
      this.rowOrder.push(row.id);
    }
    this.rowsById.set(row.id, row);
  }

  private emitIfChanged(): void {
    const next = this.snapshot();
    if (sameTasks(next, this.latestTasks)) return;
    this.latestTasks = next;
    this.emit("tasks", next);
  }

  private snapshot(): Task[] {
    const out: Task[] = [];
    for (const id of this.rowOrder) {
      const row = this.rowsById.get(id);
      if (!row) continue;
      const t: Task = { step: row.step, status: row.status };
      if (row.activeForm) t.activeForm = row.activeForm;
      out.push(t);
    }
    return out;
  }
}

function sameTasks(a: Task[] | null, b: Task[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.step !== y.step) return false;
    if (x.status !== y.status) return false;
    if ((x.activeForm ?? "") !== (y.activeForm ?? "")) return false;
  }
  return true;
}
