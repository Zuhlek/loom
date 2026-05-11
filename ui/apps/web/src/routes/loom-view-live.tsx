/**
 * LoomViewLive — the real `/loom/:projectId/:loomName` route.
 *
 * Fetches `/api/loom/:projectId/:loomName` on mount and on prop
 * change. Auto-refreshes every 5 s so changes from a running /weave
 * chat appear without a manual reload. The static demo at
 * `/loom/:phase?` (used by the mockup browser) stays separate.
 *
 * Markdown rendering uses `marked` (~25 KB). DOMPurify is intentionally
 * skipped: loom artifacts are written by /weave on the user's own
 * machine, so the trust model is loose. If we ever start ingesting
 * untrusted markdown into the loom, this is the place to wire
 * sanitization.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { LiveSidebar } from "../components/LiveSidebar";
import { PhaseStepper, type PhaseId } from "../components/loom/PhaseStepper";

interface PipelineSummary {
  current: { phase: string | null; status: string | null };
  approvals: Record<string, string | number | boolean | null>;
  pending: Record<string, unknown>;
}

interface LoomTreeEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

interface LoomViewResponse {
  projectId: string;
  projectName: string;
  loomName: string;
  loomDir: string;
  pipeline: PipelineSummary | null;
  tree: LoomTreeEntry[];
  artifacts: Record<string, string>;
  events: Array<Record<string, unknown> | { raw: string }>;
  mockupPages: string[];
}

const KNOWN_ARTIFACTS = [
  // Idea
  "idea.md",
  "decisions.md",
  // Design
  "design.md",
  // Plan
  "plan.md",
  "board.md",
  "task.md",
  // Build
  "tests.md",
  "test-report.md",
  "develop-log.md",
  // Review
  "review.md",
  "feedback.md",
  "quality-review.md",
  // Legacy / shared
  "summary.md",
  "seed.md",
  "constitution.md",
];

const PHASE_ORDER: Array<{ key: string; phase: PhaseId }> = [
  { key: "idea",   phase: "idea" },
  { key: "design", phase: "design" },
  { key: "plan",   phase: "plan" },
  { key: "build",  phase: "build" },
  { key: "review", phase: "review" },
];

const PHASE_KEYS: readonly PhaseId[] = ["idea", "design", "plan", "build", "review"];

function phaseFromPipeline(p: PipelineSummary | null): PhaseId {
  const cur = p?.current?.phase;
  if (!cur) return "idea";
  const m = PHASE_ORDER.find((x) => x.key === cur);
  return m?.phase ?? "idea";
}

function phaseStatesFor(
  currentKey: string | null | undefined,
  currentStatus: string | null | undefined,
): Partial<Record<PhaseId, "pending" | "complete" | "active" | "todo">> {
  const states: Partial<Record<PhaseId, "pending" | "complete" | "active" | "todo">> = {};
  // Review + complete = every lane shows the green check.
  if (currentKey === "review" && currentStatus === "complete") {
    for (const id of PHASE_KEYS) states[id] = "complete";
    return states;
  }
  const idx = currentKey ? PHASE_KEYS.indexOf(currentKey as PhaseId) : -1;
  if (idx < 0) {
    states.idea = "active";
    return states;
  }
  PHASE_KEYS.forEach((id, i) => {
    if (i < idx) states[id] = "complete";
    else if (i === idx) states[id] = "active";
    // i > idx → leave undefined; PhaseStepper renders it as "todo"
  });
  return states;
}

interface LoomViewLiveProps {
  projectId: string;
  loomName: string;
}

export function LoomViewLive({ projectId, loomName }: LoomViewLiveProps) {
  const [data, setData] = useState<LoomViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("idea.md");
  const [eventsCollapsed, setEventsCollapsed] = useState(false);
  const fetchAbort = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    fetchAbort.current?.abort();
    const ctrl = new AbortController();
    fetchAbort.current = ctrl;
    try {
      const res = await fetch(
        `/api/loom/${encodeURIComponent(projectId)}/${encodeURIComponent(loomName)}`,
        { signal: ctrl.signal },
      );
      if (!res.ok) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body}`);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as LoomViewResponse;
      setData(json);
      setError(null);
      setLoading(false);
      // Pick the first available known artifact if the previously
      // selected one doesn't exist in this loom yet.
      if (!json.artifacts[selected]) {
        const first = KNOWN_ARTIFACTS.find((n) => json.artifacts[n]);
        if (first) setSelected(first);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message ?? "fetch failed");
      setLoading(false);
    }
  }, [projectId, loomName, selected]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    fetchData();
    const id = window.setInterval(fetchData, 5000);
    return () => {
      window.clearInterval(id);
      fetchAbort.current?.abort();
    };
  }, [projectId, loomName, fetchData]);

  const phase = phaseFromPipeline(data?.pipeline ?? null);
  const phaseStates = useMemo(
    () => phaseStatesFor(data?.pipeline?.current?.phase ?? null, data?.pipeline?.current?.status ?? null),
    [data?.pipeline?.current?.phase, data?.pipeline?.current?.status],
  );
  const selectedContent = data?.artifacts[selected] ?? "";
  const renderedHtml = useMemo(() => {
    if (!selectedContent) return "";
    try {
      return marked.parse(selectedContent, { async: false }) as string;
    } catch {
      return "";
    }
  }, [selectedContent]);

  return (
    <div className="h-screen flex">
      <LiveSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="px-5 py-2.5 flex items-center gap-3">
            <span className="text-sm font-medium font-mono">
              {data?.projectName ?? "…"} · {loomName}
            </span>
            <PhaseBadge phase={data?.pipeline?.current?.phase ?? null} status={data?.pipeline?.current?.status ?? null} />
            <button
              data-testid="loom-refresh"
              onClick={() => fetchData()}
              className="ml-auto text-[11px] px-2 py-0.5 rounded hover:bg-[var(--accent)]"
              style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
              title="Refresh now"
            >
              Refresh
            </button>
            <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>
              {data?.loomDir ?? ""}
            </span>
          </div>
          <PhaseStepper current={phase} states={phaseStates} />
        </header>

        {loading && !data && (
          <div className="px-5 py-6 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Loading loom…
          </div>
        )}
        {error && (
          <div className="mx-5 mt-3 rounded border p-3 text-xs" style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.06)", color: "var(--destructive-foreground)" }}>
            Failed to load loom: {error}
          </div>
        )}

        {data && (
          <div className="flex-1 flex min-h-0">
            <LoomFileTree
              tree={data.tree}
              artifacts={data.artifacts}
              selected={selected}
              onSelect={(name) => setSelected(name)}
            />
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="max-w-3xl">
                  <div className="text-[10px] uppercase tracking-wide font-mono mb-1" style={{ color: "var(--muted-foreground)" }}>
                    {selected}
                  </div>
                  {selectedContent ? (
                    renderedHtml ? (
                      <article
                        className="text-sm leading-relaxed prose-loom"
                        // Trust assumption: artifacts are written by /weave on the
                        // user's machine; not user-supplied untrusted markdown.
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                      />
                    ) : (
                      <pre className="text-[12px] font-mono whitespace-pre-wrap">{selectedContent}</pre>
                    )
                  ) : (
                    <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                      No content available for {selected}.
                    </p>
                  )}
                </div>
              </div>
              <EventsTailLive
                events={data.events}
                collapsed={eventsCollapsed}
                onToggle={() => setEventsCollapsed((v) => !v)}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PhaseBadge({ phase, status }: { phase: string | null; status: string | null }) {
  if (!phase) return null;
  return (
    <span
      className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded font-mono"
      style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
      title={status ? `${phase} · ${status}` : phase}
    >
      {phase}
      {status ? ` · ${status}` : ""}
    </span>
  );
}

function LoomFileTree({
  tree,
  artifacts,
  selected,
  onSelect,
}: {
  tree: LoomTreeEntry[];
  artifacts: Record<string, string>;
  selected: string;
  onSelect: (name: string) => void;
}) {
  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.012)" }}
    >
      <div className="px-3 py-2.5 border-b text-xs flex items-center gap-1.5" style={{ borderColor: "var(--border)" }}>
        <code className="font-mono">files</code>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 text-[12px]">
        <div className="space-y-0.5">
          {tree.map((f) => {
            const depth = f.path.split("/").length - 1;
            const indent = depth * 12;
            const isKnown = !f.isDirectory && artifacts[f.path] != null;
            const active = !f.isDirectory && f.path === selected;
            return (
              <div
                key={f.path}
                onClick={() => {
                  if (!f.isDirectory && isKnown) onSelect(f.path);
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded font-mono"
                style={{
                  paddingLeft: 6 + indent,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--foreground)" : "var(--muted-foreground)",
                  cursor: !f.isDirectory && isKnown ? "pointer" : "default",
                  opacity: !f.isDirectory && !isKnown ? 0.5 : 1,
                }}
              >
                <span>
                  {f.isDirectory ? "📁" : "📄"} {f.name}
                </span>
                {!f.isDirectory && (
                  <span className="ml-auto text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                    {humanSize(f.size)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function humanSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

function EventsTailLive({
  events,
  collapsed,
  onToggle,
}: {
  events: Array<Record<string, unknown> | { raw: string }>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const last = events.slice(-50);
  return (
    <div className="border-t shrink-0" style={{ borderColor: "var(--border)", background: "#0a0a0a", color: "#d4d4d4" }}>
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 border-b flex items-center gap-2 text-[10px] text-left"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <span className="size-1.5 rounded-full animate-pulse" style={{ background: "var(--success)" }} />
        <span className="font-mono" style={{ color: "rgba(255,255,255,0.6)" }}>events.jsonl</span>
        <span className="font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          last {last.length}
        </span>
        <span className="ml-auto font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          {collapsed ? "show ▸" : "hide ▾"}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 py-2 max-h-40 overflow-y-auto font-mono text-[11px] space-y-0.5">
          {last.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span style={{ color: "rgba(255,255,255,0.4)" }}>{(e as any).ts ?? ""}</span>
              <span>{stringifyEvent(e)}</span>
            </div>
          ))}
          {last.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.4)" }}>(no events)</div>
          )}
        </div>
      )}
    </div>
  );
}

function stringifyEvent(e: any): string {
  if (e && typeof e === "object" && "raw" in e) return String((e as any).raw);
  try {
    const { ts: _ts, ...rest } = e ?? {};
    return JSON.stringify(rest);
  } catch {
    return String(e);
  }
}
