import { useState } from "react";

type Candidate = {
  path: string;
  repos: number;
  looms: number;
  lastAccessed: string;
  recommended?: boolean;
  projectTags?: string[];
};

const DEFAULT_CANDIDATES: Candidate[] = [
  {
    path: "~/dev/repo",
    repos: 12,
    looms: 3,
    lastAccessed: "2h ago",
    recommended: true,
    projectTags: ["nora", "cinnamon", "visana", "+9 more"],
  },
  { path: "~/code", repos: 5, looms: 0, lastAccessed: "14d ago" },
  { path: "~/Documents/work", repos: 2, looms: 0, lastAccessed: "41d ago" },
];

/** Mockup 01: first-run discover wizard. Static placeholder data. */
export function DiscoverWizard() {
  const [selected, setSelected] = useState("~/dev/repo");
  const [customPath, setCustomPath] = useState("");

  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "linear-gradient(180deg, #fafaf9 0%, #f5f5f4 100%)" }}>
      <div
        className="w-full max-w-xl mx-4 rounded-2xl border bg-white overflow-hidden"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="px-6 py-5 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <div className="size-9 rounded-xl grid place-items-center text-white text-base font-semibold" style={{ background: "var(--primary)" }}>
            N
          </div>
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Welcome to nora</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Pick a workspace root so nora can discover your repos and looms.
            </p>
          </div>
          <span
            className="text-[10px] uppercase tracking-[0.12em] font-medium px-2 py-0.5 rounded-full"
            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
          >
            Step 1 of 1
          </span>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <h2 className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
              Detected candidates
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Scanned <span className="font-mono">~</span>, <span className="font-mono">~/dev</span>, <span className="font-mono">~/Documents</span>, <span className="font-mono">~/code</span> for repos containing <span className="font-mono">.loom/&lt;project&gt;/</span>.
            </p>
          </div>

          <div className="space-y-1.5">
            {DEFAULT_CANDIDATES.map((c) => {
              const isSelected = selected === c.path;
              return (
                <label
                  key={c.path}
                  onClick={() => setSelected(c.path)}
                  className="group flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                  style={
                    isSelected
                      ? { borderWidth: 2, borderStyle: "solid", borderColor: "var(--primary)", background: "rgba(59, 130, 246, 0.04)" }
                      : { borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)" }
                  }
                >
                  <div className="mt-0.5">
                    <div
                      className="size-4 rounded-full grid place-items-center"
                      style={{ borderWidth: 2, borderStyle: "solid", borderColor: isSelected ? "var(--primary)" : "var(--border)" }}
                    >
                      {isSelected && <div className="size-2 rounded-full" style={{ background: "var(--primary)" }} />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{c.path}</span>
                      {c.recommended && (
                        <span
                          className="text-[10px] uppercase tracking-wide font-medium px-1.5 rounded"
                          style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--success-foreground)" }}
                        >
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                      {c.repos} git repos · {c.looms} looms {c.looms > 0 ? "found" : ""} · last accessed {c.lastAccessed}
                    </p>
                    {c.projectTags && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {c.projectTags.map((t) => (
                          <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-xs font-medium mb-1.5">Or enter a custom path</h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border bg-white" style={{ borderColor: "var(--border)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 shrink-0" style={{ color: "var(--muted-foreground)" }}>
                  <path d="M3 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <input
                  type="text"
                  placeholder="/Users/tristan/dev/work"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm font-mono placeholder:text-[var(--muted-foreground)]/60"
                />
              </div>
              <button className="px-3 py-2 rounded-lg text-xs font-medium border hover:bg-[var(--accent)]" style={{ borderColor: "var(--border)" }}>
                Browse...
              </button>
            </div>
            <p className="text-[10px] mt-1.5 font-mono" style={{ color: "var(--muted-foreground)" }}>
              resolved → ~/.nora/config.json on Continue
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.015)" }}>
          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            Resolution: CLI <code className="font-mono">--root</code> &gt; <code className="font-mono">~/.nora/config.json</code> &gt; this wizard
          </span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-lg text-xs font-medium hover:bg-[var(--accent)]" style={{ color: "var(--muted-foreground)" }}>
              Skip for now
            </button>
            <button className="px-4 py-2 rounded-lg text-xs font-medium text-white shadow-sm" style={{ background: "var(--primary)" }}>
              Continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
