/**
 * LoomViewLive — the real `/loom/:projectId/:loomName` route.
 *
 * Fetches `/api/loom/:projectId/:loomName` on mount and on prop
 * change. Auto-refreshes every 5 s so changes from a running /weave
 * chat appear without a manual reload.
 *
 * Markdown rendering uses `marked` (~25 KB). DOMPurify is intentionally
 * skipped: loom artifacts are written by /weave on the user's own
 * machine, so the trust model is loose. If we ever start ingesting
 * untrusted markdown into the loom, this is the place to wire
 * sanitization.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { AppLayout } from "../components/layout/AppLayout";
import { LiveSidebar } from "../components/LiveSidebar";
import { PhaseStepper, type PhaseId } from "../components/loom/PhaseStepper";
import { LoomEmptyState } from "../components/loom/LoomEmptyState";
import { listProjects, type ApiProject } from "../lib/api";
import { BACKEND_ONLINE_EVENT } from "../lib/useHealthPoll";

interface PipelineSummary {
  current: { phase: string | null; status: string | null };
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
  mockupPages: string[];
}

const PHASE_KEYS: readonly PhaseId[] = ["spec", "design", "plan", "build", "review"];

function phaseFromPipeline(p: PipelineSummary | null): PhaseId {
  const cur = p?.current?.phase;
  if (cur && (PHASE_KEYS as readonly string[]).includes(cur)) return cur as PhaseId;
  return "spec";
}

function phaseStatesFor(
  currentKey: string | null | undefined,
  currentStatus: string | null | undefined,
): Partial<Record<PhaseId, "pending" | "complete" | "active" | "todo">> {
  const states: Partial<Record<PhaseId, "pending" | "complete" | "active" | "todo">> = {};
  if (currentKey === "review" && currentStatus === "complete") {
    for (const id of PHASE_KEYS) states[id] = "complete";
    return states;
  }
  const idx = currentKey ? PHASE_KEYS.indexOf(currentKey as PhaseId) : -1;
  if (idx < 0) {
    states.spec = "active";
    return states;
  }
  PHASE_KEYS.forEach((id, i) => {
    if (i < idx) states[id] = "complete";
    else if (i === idx) states[id] = "active";
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
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("spec.md");
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
      // US-008 AC1, AC3: a 404 means the loom directory does not
      // exist under any of the project's declared paths. Render
      // the dedicated empty state instead of the generic error
      // chip (which previously surfaced "HTTP 404: ...").
      if (res.status === 404) {
        setNotFound(true);
        setError(null);
        setLoading(false);
        // Best-effort: fetch the project so the empty state can name
        // it and list its declared paths. If the project lookup
        // itself fails we still render the empty state — minus the
        // project context.
        try {
          const { projects } = await listProjects();
          const match = projects.find((p) => p.id === projectId) ?? null;
          setProject(match);
        } catch {
          /* fall through with project = null */
        }
        return;
      }
      if (!res.ok) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body}`);
        setNotFound(false);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as LoomViewResponse;
      setData(json);
      setError(null);
      setNotFound(false);
      setLoading(false);
      if (!json.artifacts[selected]) {
        const first = Object.keys(json.artifacts).find((n) => n.endsWith(".md")) ?? Object.keys(json.artifacts)[0];
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
    // US-005 AC2: refetch on backend-recovery event.
    const onOnline = () => {
      void fetchData();
    };
    window.addEventListener(BACKEND_ONLINE_EVENT, onOnline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(BACKEND_ONLINE_EVENT, onOnline);
      fetchAbort.current?.abort();
    };
  }, [projectId, loomName, fetchData]);

  const phase = phaseFromPipeline(data?.pipeline ?? null);
  const phaseStates = useMemo(
    () => phaseStatesFor(data?.pipeline?.current?.phase ?? null, data?.pipeline?.current?.status ?? null),
    [data?.pipeline?.current?.phase, data?.pipeline?.current?.status],
  );
  const selectedContent = data?.artifacts[selected] ?? "";
  const isMarkdown = selected.endsWith(".md");
  const renderedHtml = useMemo(() => {
    if (!selectedContent || !isMarkdown) return "";
    try {
      return marked.parse(selectedContent, { async: false }) as string;
    } catch {
      return "";
    }
  }, [selectedContent, isMarkdown]);

  const topBar = (
    <button
      data-testid="loom-refresh"
      onClick={() => fetchData()}
      className="ml-auto text-[11px] px-2 py-0.5 rounded hover:bg-[var(--accent)]"
      style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
      title="Refresh now"
    >
      Refresh
    </button>
  );

  return (
    <AppLayout topBar={topBar} leftDrawer={<LiveSidebar />}>
        {loading && !data && !notFound && (
          <div className="px-5 py-6 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Loading loom…
          </div>
        )}
        {/* US-008 AC1: dedicated empty state for the unresolvable loom case. */}
        {notFound && (
          <LoomEmptyState
            loomName={loomName}
            projectName={project?.name ?? projectId}
            paths={project?.paths ?? []}
          />
        )}
        {error && !notFound && (
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
              <div
                className="shrink-0 flex flex-col items-center justify-center border-b px-5 py-3 gap-1"
                style={{ borderColor: "var(--border)" }}
              >
                <PhaseStepper current={phase} states={phaseStates} />
                {/* US-009 AC1: surface the read-only contract near the stepper. */}
                <p
                  className="text-[10px] font-mono"
                  style={{ color: "var(--muted-foreground)" }}
                  data-testid="loom-readonly-hint"
                >
                  read-only — pipeline owned by /weave
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="max-w-3xl mx-auto">
                  <div className="text-[10px] uppercase tracking-wide font-mono mb-1" style={{ color: "var(--muted-foreground)" }}>
                    {selected}
                  </div>
                  {selectedContent ? (
                    isMarkdown && renderedHtml ? (
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
            </div>
          </div>
        )}
    </AppLayout>
  );
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: TreeNode[];
}

function buildTree(entries: LoomTreeEntry[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (const e of sorted) {
    const node: TreeNode = {
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      size: e.size,
      children: [],
    };
    byPath.set(e.path, node);
    const slashIdx = e.path.lastIndexOf("/");
    if (slashIdx < 0) {
      roots.push(node);
    } else {
      const parent = byPath.get(e.path.slice(0, slashIdx));
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  }
  return roots;
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
  const roots = useMemo(() => buildTree(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = useCallback(
    (path: string) => setCollapsed((c) => ({ ...c, [path]: !c[path] })),
    [],
  );
  return (
    <aside
      className="w-56 shrink-0 flex flex-col border-r overflow-y-auto px-1 py-1 text-[11px]"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.012)" }}
    >
      {roots.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          artifacts={artifacts}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </aside>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  toggle,
  artifacts,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Record<string, boolean>;
  toggle: (path: string) => void;
  artifacts: Record<string, string>;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const isOpen = !collapsed[node.path];
  const isFile = !node.isDirectory;
  const isReadable = isFile && artifacts[node.path] != null;
  const isActive = isFile && node.path === selected;
  return (
    <>
      <div
        onClick={() => {
          if (node.isDirectory) toggle(node.path);
          else if (isReadable) onSelect(node.path);
        }}
        className="flex items-center gap-1 rounded px-1 py-[2px] select-none"
        style={{
          paddingLeft: 4 + depth * 10,
          background: isActive ? "var(--accent)" : "transparent",
          color: isActive ? "var(--foreground)" : isReadable || node.isDirectory ? "var(--foreground)" : "var(--muted-foreground)",
          cursor: node.isDirectory || isReadable ? "pointer" : "default",
          opacity: isFile && !isReadable ? 0.55 : 1,
        }}
      >
        {node.isDirectory ? (
          <ChevronIcon open={isOpen} />
        ) : (
          <span className="inline-block w-2.5" />
        )}
        {node.isDirectory ? <FolderIcon open={isOpen} /> : <FileIcon name={node.name} />}
        <span className="truncate flex-1">{node.name}</span>
        {isFile && (
          <span className="text-[9px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
            {humanSize(node.size)}
          </span>
        )}
      </div>
      {node.isDirectory && isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            toggle={toggle}
            artifacts={artifacts}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="size-2.5 shrink-0 transition-transform"
      style={{ color: "var(--muted-foreground)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="size-3.5 shrink-0"
      style={{ color: open ? "var(--info)" : "var(--muted-foreground)" }}
      aria-hidden
    >
      {open ? (
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1H5l-2 9V7z" strokeLinejoin="round" />
      ) : (
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const tint =
    ext === "md"
      ? "var(--info)"
      : ext === "json" || ext === "jsonl"
      ? "var(--warning)"
      : ext === "sh"
      ? "var(--success)"
      : "var(--muted-foreground)";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="size-3.5 shrink-0"
      style={{ color: tint }}
      aria-hidden
    >
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" strokeLinejoin="round" />
      <path d="M14 3v6h6" strokeLinejoin="round" />
    </svg>
  );
}

function humanSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}
