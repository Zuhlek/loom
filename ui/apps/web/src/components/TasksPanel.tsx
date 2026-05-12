/**
 * TasksPanel — the right-hand "TASKS" side panel populated from claude's
 * task-tracking tool calls (TodoWrite, or TaskCreate/TaskUpdate on
 * Claude Code ≥ 2.1.x). Mirrors t3code's PlanSidebar visually.
 *
 * Data shape: the server tails the JSONL transcript and sends
 * `{kind: "tasks-update", body: {tasks: Task[]}}` over the existing WS.
 * This component just renders the latest snapshot — the parent route
 * owns subscription + open/close state.
 *
 * Layout: right-side rail, ~340 px wide when open. When closed the
 * panel renders nothing; the "Tasks" button in the chat header is the
 * sole toggle.
 */

export type TaskStatus = "pending" | "inProgress" | "completed";

export interface Task {
  step: string;
  status: TaskStatus;
  activeForm?: string;
}

interface Props {
  tasks: Task[] | null;
  open: boolean;
  onToggle: () => void;
  /** When was the last `tasks-update` received? Surfaced inline above the list. */
  lastUpdatedAt: number | null;
}

const PANEL_WIDTH = 340;

export function TasksPanel({ tasks, open, lastUpdatedAt }: Props) {
  if (!open) return null;

  return (
    <aside
      data-testid="tasks-panel"
      className="flex flex-col border-l"
      style={{ width: PANEL_WIDTH, borderColor: "var(--border)", background: "var(--card, #f5f5f5)" }}
    >
      <div className="px-3 pt-3 pb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-wider" style={{ color: "var(--muted-foreground)" }}>
          TASKS
        </span>
        <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
          {lastUpdatedAt ? `updated ${formatTimeShort(lastUpdatedAt)}` : "no updates yet"}
        </span>
      </div>

      <ol className="flex-1 overflow-y-auto px-2 pb-2 list-none">
        {tasks && tasks.length > 0
          ? tasks.map((t, idx) => <TaskRow key={`${idx}-${t.step}`} task={t} />)
          : null}
      </ol>
    </aside>
  );
}

function TaskRow({ task }: { task: Task }) {
  const inProgress = task.status === "inProgress";
  const completed = task.status === "completed";
  const label = inProgress && task.activeForm ? task.activeForm : task.step;
  return (
    <li
      data-status={task.status}
      className="flex items-start gap-2 rounded px-2 py-1.5 my-0.5 text-xs"
      style={{
        background: inProgress ? "rgba(59, 130, 246, 0.10)" : "transparent",
      }}
    >
      <StatusIcon status={task.status} />
      <span
        className="flex-1"
        style={{
          color: completed ? "var(--muted-foreground)" : "var(--foreground)",
          textDecoration: completed ? "line-through" : "none",
        }}
      >
        {label}
      </span>
    </li>
  );
}

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") {
    return (
      <svg
        aria-label="completed"
        width="14"
        height="14"
        viewBox="0 0 20 20"
        className="mt-[2px] shrink-0"
        fill="none"
      >
        <circle cx="10" cy="10" r="9" fill="#16a34a" />
        <path
          d="M5.5 10.5l3 3 6-6.5"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (status === "inProgress") {
    return (
      <svg
        aria-label="in progress"
        width="14"
        height="14"
        viewBox="0 0 20 20"
        className="mt-[2px] shrink-0 tasks-spinner"
        fill="none"
      >
        <circle cx="10" cy="10" r="8" stroke="#3b82f6" strokeWidth="2" strokeOpacity="0.2" />
        <path
          d="M18 10a8 8 0 0 0-8-8"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-label="pending"
      width="14"
      height="14"
      viewBox="0 0 20 20"
      className="mt-[2px] shrink-0"
      fill="none"
    >
      <circle cx="10" cy="10" r="8" stroke="#9ca3af" strokeWidth="2" />
    </svg>
  );
}

function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
