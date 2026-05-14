/**
 * FabricViewLive — the `/fabric/:projectId/:fabricName` route.
 *
 * Fetches `/api/fabric/:projectId/:fabricName` on mount and on prop
 * change. Auto-refreshes every 5 s so changes from a running /weave
 * chat appear without a manual reload. Markdown rendering is delegated
 * to {@link FabricMarkdown}; raw-file rendering to {@link FabricViewer}.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AppLayout } from "../components/layout/AppLayout";
import { LiveSidebar } from "../components/LiveSidebar";
import { PhaseStepper, type PhaseId } from "../components/fabric/PhaseStepper";
import { FabricEmptyState } from "../components/fabric/FabricEmptyState";
import { FabricMarkdown } from "../components/fabric/FabricMarkdown";
import { FabricViewer } from "../components/fabric/FabricViewer";
import { FileTreeDrawer } from "../components/fabric/FileTreeDrawer";
import {
  PHASE_TO_FILE,
  PHASE_EMPTY_COPY,
  FABRIC_EMPTY_COPY,
} from "../components/fabric/fabric-phase-map";
import { listProjects, type ApiProject } from "../lib/api";
import { BACKEND_ONLINE_EVENT } from "../lib/useHealthPoll";

interface PipelineSummary {
  current: { phase: string | null; status: string | null };
}

interface FabricTreeEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
}

interface FabricViewResponse {
  projectId: string;
  projectName: string;
  fabricName: string;
  loomDir: string;
  pipeline: PipelineSummary | null;
  tree: FabricTreeEntry[];
  artifacts: Record<string, string>;
  mockupPages: string[];
}

const PHASE_KEYS: readonly PhaseId[] = ["spec", "design", "plan", "build", "review"];

function phaseFromPipeline(pipeline: PipelineSummary | null): PhaseId {
  const current = pipeline?.current?.phase;
  if (current && (PHASE_KEYS as readonly string[]).includes(current)) {
    return current as PhaseId;
  }
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
  PHASE_KEYS.forEach((id, index) => {
    if (index < idx) states[id] = "complete";
    else if (index === idx) states[id] = "active";
  });
  return states;
}

interface FabricViewLiveProps {
  projectId: string;
  fabricName: string;
}

export function FabricViewLive({ projectId, fabricName }: FabricViewLiveProps) {
  const [data, setData] = useState<FabricViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<PhaseId | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fetchAbort = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;
    try {
      const response = await fetch(
        `/api/fabric/${encodeURIComponent(projectId)}/${encodeURIComponent(fabricName)}`,
        { signal: controller.signal },
      );
      if (response.status === 404) {
        setNotFound(true);
        setError(null);
        setLoading(false);
        try {
          const { projects } = await listProjects();
          const match = projects.find((entry) => entry.id === projectId) ?? null;
          setProject(match);
        } catch {
          /* fall through with project = null */
        }
        return;
      }
      if (!response.ok) {
        const body = await response.text();
        setError(`HTTP ${response.status}: ${body}`);
        setNotFound(false);
        setLoading(false);
        return;
      }
      const json = (await response.json()) as FabricViewResponse;
      setData(json);
      setError(null);
      setNotFound(false);
      setLoading(false);
    } catch (cause: unknown) {
      if ((cause as { name?: string })?.name === "AbortError") return;
      const message =
        cause instanceof Error ? cause.message : "fetch failed";
      setError(message);
      setLoading(false);
    }
  }, [projectId, fabricName]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    setSelectedPhase(null);
    setSelectedFile(null);
    setDrawerOpen(false);
    fetchData();
    const intervalId = window.setInterval(fetchData, 5000);
    const onOnline = () => {
      void fetchData();
    };
    window.addEventListener(BACKEND_ONLINE_EVENT, onOnline);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(BACKEND_ONLINE_EVENT, onOnline);
      fetchAbort.current?.abort();
    };
  }, [projectId, fabricName, fetchData]);

  useEffect(() => {
    if (selectedPhase === null && data) {
      setSelectedPhase(phaseFromPipeline(data.pipeline));
    }
  }, [data, selectedPhase]);

  const phaseStates = useMemo(
    () =>
      phaseStatesFor(
        data?.pipeline?.current?.phase ?? null,
        data?.pipeline?.current?.status ?? null,
      ),
    [data?.pipeline?.current?.phase, data?.pipeline?.current?.status],
  );

  const phaseStepperCurrent = selectedPhase ?? "spec";
  const phaseFile = selectedPhase ? PHASE_TO_FILE[selectedPhase] : null;
  const phaseFileContent =
    phaseFile && data ? (data.artifacts[phaseFile] ?? null) : null;
  const fabricTreeEmpty = (data?.tree.length ?? 0) === 0;

  const toggleRail = () => {
    setDrawerOpen((open) => {
      const next = !open;
      if (!next) setSelectedFile(null);
      return next;
    });
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile((prev) => (prev === path ? null : path));
  };

  const viewerMounted = drawerOpen && selectedFile !== null;

  const topBar = (
    <div className="flex-1 min-w-0" />
  );

  const rightRail = (
    <aside
      className="w-10 shrink-0 flex flex-col items-center border-l py-2 gap-1"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <button
        type="button"
        data-testid="fabric-tree-toggle"
        onClick={toggleRail}
        aria-pressed={drawerOpen}
        className={clsx(
          "size-7 rounded-md grid place-items-center hover:bg-[var(--accent)]",
          drawerOpen
            ? "bg-blue-500/10 text-blue-600"
            : "text-[var(--muted-foreground)]",
        )}
        title={drawerOpen ? "Hide file tree" : "Show file tree"}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4"
        >
          <path d="M3 5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" />
          <path d="M8 11h8M8 15h5" />
        </svg>
      </button>
    </aside>
  );

  const rightDrawer = drawerOpen && data ? (
    <FileTreeDrawer
      rootLabel={fabricName}
      tree={data.tree}
      artifacts={data.artifacts}
      selectedPath={selectedFile}
      onSelect={handleFileSelect}
      onRefresh={() => fetchData()}
    />
  ) : undefined;

  return (
    <AppLayout
      topBar={topBar}
      leftDrawer={<LiveSidebar />}
      rightDrawer={rightDrawer}
      rightRail={rightRail}
    >
      {loading && !data && !notFound && (
        <div className="px-5 py-6 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading fabric…
        </div>
      )}
      {notFound && (
        <FabricEmptyState
          fabricName={fabricName}
          projectName={project?.name ?? projectId}
          paths={project?.paths ?? []}
        />
      )}
      {error && !notFound && (
        <div
          className="mx-5 mt-3 rounded border p-3 text-xs"
          style={{
            borderColor: "rgba(239,68,68,0.4)",
            background: "rgba(239,68,68,0.06)",
            color: "var(--destructive-foreground)",
          }}
        >
          Failed to load fabric: {error}
        </div>
      )}

      {data && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <div
              className="shrink-0 flex items-center justify-center border-b px-5 py-3"
              style={{ borderColor: "var(--border)" }}
            >
              <PhaseStepper
                selected={phaseStepperCurrent}
                states={phaseStates}
                onSelect={(id) => setSelectedPhase(id)}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="max-w-3xl mx-auto">
                {fabricTreeEmpty ? (
                  <p
                    className="text-sm"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {FABRIC_EMPTY_COPY}
                  </p>
                ) : phaseFile ? (
                  <>
                    <div
                      className="text-[10px] uppercase tracking-wide font-mono mb-1"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {phaseFile}
                    </div>
                    {phaseFileContent != null ? (
                      <FabricMarkdown source={phaseFileContent} />
                    ) : (
                      <p
                        className="text-sm"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {PHASE_EMPTY_COPY[selectedPhase ?? "spec"]}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
          {viewerMounted && selectedFile && (
            <div
              className="w-[420px] shrink-0 flex flex-col min-h-0 border-l overflow-y-auto"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
              data-testid="fabric-viewer-column"
            >
              <div className="px-3 pt-3 pb-1">
                <div
                  className="text-[10px] uppercase tracking-wide font-mono"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {selectedFile}
                </div>
              </div>
              <div className="flex-1 px-3 py-2 text-sm leading-relaxed">
                <FabricViewer
                  path={selectedFile}
                  content={data.artifacts[selectedFile]}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}
