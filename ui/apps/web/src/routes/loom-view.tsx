import { PhaseStepper, type PhaseId } from "../components/loom/PhaseStepper";
import { FileTreeView, type LoomFile } from "../components/loom/FileTreeView";
import { EventsTail } from "../components/loom/EventsTail";
import { KanbanView, type KanbanColumn } from "../components/loom/KanbanView";

const FILES: LoomFile[] = [
  { path: ".pipeline/", isDirectory: true, expanded: true },
  { path: "pending.idea.q1", depth: 1, pending: true },
  { path: "idea.md", active: true },
  { path: "decisions.md" },
  { path: "plan.md", dimmed: true },
  { path: "mockup/", isDirectory: true, dimmed: true },
  { path: "events.jsonl" },
  { path: "constitution.md" },
  { path: "seed.md" },
];

const SAMPLE_PLAN_FILES: LoomFile[] = FILES.map((f) => ({ ...f, dimmed: false }));

const SAMPLE_BUILD_FILES: LoomFile[] = [
  { path: "board.md", active: true },
  { path: "tasks/", isDirectory: true, expanded: true },
  { path: "T-001.task.md", depth: 1 },
  { path: "T-002.task.md", depth: 1 },
  { path: "T-003.task.md", depth: 1 },
  { path: "events.jsonl" },
  { path: "plan.md" },
  { path: "idea.md" },
];

const KANBAN: KanbanColumn[] = [
  {
    id: "backlog",
    label: "Backlog",
    cards: [
      { id: "t-006", title: "PGlite metadata schema", tags: ["backend"], size: "M" },
      { id: "t-007", title: "Hook installer marker", tags: ["backend"], size: "S" },
      { id: "t-008", title: "Multi-SCM provider plugins", tags: ["scm"], size: "L" },
    ],
  },
  {
    id: "in-progress",
    label: "In Progress",
    cards: [
      { id: "t-002", title: "Sidebar Chats+Looms grouping", subtitle: "Snapshot extension + sub-section render", tags: ["frontend"], size: "M", duration: "7m", active: true },
      { id: "t-005", title: "DiffPanel lift-and-adapt", subtitle: "From t3code; @pierre/diffs license check", tags: ["frontend"], size: "L", duration: "21m", active: true },
    ],
  },
  {
    id: "review",
    label: "Review",
    cards: [{ id: "t-003", title: "Spawn dialog (cwd + perm + worktree)", tags: ["frontend"], size: "M", reviewer: true }],
  },
  {
    id: "done",
    label: "Done",
    cards: [
      { id: "t-001", title: "Bootstrap loom-server", tags: ["backend"], duration: "14m", done: true },
      { id: "t-004", title: "PTY bridge (node-pty)", tags: ["backend"], duration: "9m", done: true },
    ],
  },
];

const SAMPLE_EVENTS = [
  { ts: "14:31:21", level: "info" as const, message: "build_started project=loom total=8" },
  { ts: "14:31:22", level: "ok" as const, message: "task_done id=t-001 duration=14m commit=abc123f" },
  { ts: "14:31:38", level: "ok" as const, message: "task_done id=t-004 duration=9m commit=def456a" },
  { ts: "14:31:55", level: "info" as const, message: "task_started id=t-002 lane=in-progress" },
  { ts: "14:32:02", level: "info" as const, message: "task_started id=t-005 lane=in-progress" },
  { ts: "14:32:08", level: "warn" as const, message: "review_required id=t-003 reviewer=human" },
];

interface LoomViewProps {
  phase: string;
}

/** Mockups 06, 07, 08, 09. Phase prop selects the variant. */
export function LoomView({ phase }: LoomViewProps) {
  const isIdea = phase === "idea";
  const isPlan = phase === "plan";
  const isBuild = phase === "build";

  const phaseId: PhaseId = isPlan ? "plan" : isBuild ? "build" : "idea";
  const states = isPlan
    ? { idea: "complete" as const, plan: "complete" as const }
    : isBuild
    ? { idea: "complete" as const, plan: "complete" as const, build: "active" as const }
    : { idea: "pending" as const };

  const fileList = isBuild ? SAMPLE_BUILD_FILES : isPlan ? SAMPLE_PLAN_FILES.map((f) => (f.path === "plan.md" ? { ...f, active: true, dimmed: false } : f)) : FILES;

  return (
    <div className="flex flex-1 min-w-0">
      <FileTreeView rootLabel=".loom/" files={fileList} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="px-5 py-2.5 flex items-center gap-3">
            <span className="text-sm font-medium font-mono">.loom/</span>
            <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
              read-only
            </span>
            <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              ~/dev/repo/loom
            </span>
          </div>
          <PhaseStepper current={phaseId} states={states} />
        </header>

        {isIdea && <PendingBanner />}

        {isBuild ? (
          <>
            <KanbanView columns={KANBAN} />
            <EventsTail events={SAMPLE_EVENTS} />
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="max-w-3xl">
              <div className="text-[10px] uppercase tracking-wide font-mono mb-1" style={{ color: "var(--muted-foreground)" }}>
                .loom/{isPlan ? "plan.md" : "idea.md"}
              </div>
              {isPlan ? <PlanContent /> : <IdeaContent />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PendingBanner() {
  return (
    <div
      className="mx-5 mt-3 rounded-lg border p-3 flex items-start gap-2.5"
      style={{ borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}
    >
      <div className="size-5 rounded-full grid place-items-center mt-0.5" style={{ background: "rgba(245,158,11,0.2)" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="size-3" style={{ color: "var(--warning-foreground)" }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium" style={{ color: "var(--warning-foreground)" }}>
          Phase 1 has a pending question.
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Resolve it from the owning chat <span className="font-mono px-1 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>/weave loom</span> in the left nav. The loom view is read-only.
        </p>
      </div>
      <button className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }} title="Dismiss banner">
        ×
      </button>
    </div>
  );
}

function IdeaContent() {
  return (
    <article className="text-sm leading-relaxed space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Loom — chat-first Claude Code session manager + loom artifact viewer</h1>
      <h2 className="text-lg font-semibold mt-4">What it is</h2>
      <p>Localhost browser app managing Claude Code sessions with loom artifacts side-by-side in one nav. Chats produce changes, looms show state, <code className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>AskUserQuestion</code> is the only bridge.</p>
      <h2 className="text-lg font-semibold mt-4">Why</h2>
      <p>The v8 plan over-engineered a filesystem-watching pending-prompt bridge. v8 → t3code comparison revealed chats and looms are two views of one thing.</p>
      <h2 className="text-lg font-semibold mt-4">Capabilities</h2>
      <ul className="list-disc ml-5 space-y-1">
        <li><strong>Chat surface.</strong> Left-nav row per chat with permission-mode badge.</li>
        <li><strong>Loom artifact view.</strong> Peer surface in left-nav under "Looms". Read-only.</li>
        <li><strong>Worktree mode.</strong> Opt-in per chat (default off).</li>
        <li><strong>Diff view.</strong> When in worktree mode, right-side split-pane.</li>
        <li><strong>Multi-SCM.</strong> GitHub, GitLab, Bitbucket, Azure DevOps via t3code's provider plugins.</li>
      </ul>
      <h2 className="text-lg font-semibold mt-4">Throughline</h2>
      <p>Two views of one thing: chats produce changes; looms show state.</p>
    </article>
  );
}

function PlanContent() {
  return (
    <article className="text-sm leading-relaxed space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Plan — Loom</h1>
      <p style={{ color: "var(--muted-foreground)" }}>Derived from idea.md. 32 tasks; 5 AFK-runnable; rest gated by HITL.</p>
      <h2 className="text-lg font-semibold mt-4">Phases (DAG)</h2>
      <ol className="list-decimal ml-5 space-y-1">
        <li>Server bootstrap + lockfile + WS endpoint (T-001).</li>
        <li>Metadata store + hook receiver (T-002, T-003).</li>
        <li>Frontend shell + sidebar + spawn dialog (T-006 → T-010).</li>
        <li>Chat surface + JSONL tailer + composer (T-011 → T-018).</li>
        <li>Worktree mode + diff + branch toolbar (T-021 → T-024).</li>
        <li>Loom artifact view + kanban + events (T-025 → T-027).</li>
        <li>Settings + hook installer + conflict banner (T-030 → T-032).</li>
      </ol>
    </article>
  );
}
