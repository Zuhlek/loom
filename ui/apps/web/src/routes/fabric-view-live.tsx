/**
 * FabricViewLive — the `/fabric/:projectId/:fabricName` route.
 *
 * Fetches `/api/fabric/:projectId/:fabricName` on mount and on prop
 * change. Auto-refreshes every 5 s so changes from a running /weave
 * chat appear without a manual reload. The center pane renders the
 * artifact for the active phase by default; clicking a file in the
 * always-visible right-hand tree overrides the pane with that file's
 * content. The build phase's `board.md` renders through
 * {@link KanbanView} (read-only) with a Kanban/Raw toggle.
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
import { KanbanView } from "../components/fabric/KanbanView";
import { parseBoardMarkdown } from "../components/fabric/board-parser";
import {
  PHASE_TO_FILE,
  PHASE_EMPTY_COPY,
  FABRIC_EMPTY_COPY,
} from "../components/fabric/fabric-phase-map";
import { errorText, listProjects, type ApiProject } from "../lib/api";
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

type BoardViewMode = "kanban" | "raw";

export function FabricViewLive({ projectId, fabricName }: FabricViewLiveProps) {
  const [data, setData] = useState<FabricViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<PhaseId | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [boardViewMode, setBoardViewMode] = useState<BoardViewMode>("kanban");
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
      setError(errorText(cause));
      setLoading(false);
    }
  }, [projectId, fabricName]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    setSelectedPhase(null);
    setSelectedFile(null);
    setBoardViewMode("kanban");
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
  const activeFile = selectedFile ?? phaseFile;
  const activeContent =
    activeFile && data ? (data.artifacts[activeFile] ?? null) : null;
  const fabricTreeEmpty = (data?.tree.length ?? 0) === 0;
  const isBoardFile = activeFile === "board.md";

  const boardColumns = useMemo(() => {
    if (!isBoardFile || activeContent == null) return null;
    return parseBoardMarkdown(activeContent);
  }, [isBoardFile, activeContent]);

  const handleFileSelect = (path: string) => {
    setSelectedFile((prev) => (prev === path ? null : path));
  };

  const handlePhaseSelect = (id: PhaseId) => {
    setSelectedPhase(id);
    setSelectedFile(null);
  };

  const topBar = <div className="flex-1 min-w-0" />;

  const rightDrawer = data ? (
    <FileTreeDrawer
      tree={data.tree}
      artifacts={data.artifacts}
      selectedPath={activeFile}
      onSelect={handleFileSelect}
    />
  ) : undefined;

  return (
    <AppLayout topBar={topBar} leftDrawer={<LiveSidebar />} rightDrawer={rightDrawer}>
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
        <div className="flex-1 flex flex-col min-h-0">
          <div
            className="shrink-0 flex items-center justify-center border-b px-5 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <PhaseStepper
              selected={phaseStepperCurrent}
              states={phaseStates}
              onSelect={handlePhaseSelect}
            />
          </div>
          {fabricTreeEmpty ? (
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="max-w-3xl mx-auto">
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {FABRIC_EMPTY_COPY}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                className="shrink-0 flex items-center justify-between px-5 py-2"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <div
                  className="text-[10px] uppercase tracking-wide font-mono"
                  style={{ color: "var(--muted-foreground)" }}
                  data-testid="fabric-active-file"
                >
                  {activeFile ?? ""}
                </div>
                {isBoardFile && activeContent != null ? (
                  <BoardViewToggle value={boardViewMode} onChange={setBoardViewMode} />
                ) : (
                  <div />
                )}
              </div>
              {isBoardFile && boardColumns && boardViewMode === "kanban" ? (
                <KanbanView columns={boardColumns} />
              ) : (
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <div className="max-w-3xl mx-auto">
                    {activeContent != null && activeFile ? (
                      <FabricViewer path={activeFile} content={activeContent} />
                    ) : selectedPhase ? (
                      <p
                        className="text-sm"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {PHASE_EMPTY_COPY[selectedPhase]}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </AppLayout>
  );
}

function BoardViewToggle({
  value,
  onChange,
}: {
  value: BoardViewMode;
  onChange: (next: BoardViewMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border overflow-hidden text-[10px] font-mono"
      style={{ borderColor: "var(--border)" }}
      role="tablist"
      aria-label="Board view"
      data-testid="board-view-toggle"
    >
      {(["kanban", "raw"] as const).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(mode)}
            data-testid={`board-view-${mode}`}
            className={clsx("px-2 py-0.5 uppercase tracking-wide")}
            style={{
              background: active ? "var(--selected-row)" : "transparent",
              color: active ? "var(--info-foreground)" : "var(--muted-foreground)",
            }}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}
