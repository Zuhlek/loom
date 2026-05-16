# Loom evaluation harness — runbook

Measure what a `/weave` run costs. Compare across loom versions.

## Two commands

```bash
pnpm run eval:run       # runs /weave once, creates .loom/<project>/
pnpm run eval:analyse   # harvests anything new in analytics/, renders, opens HTML
```

Between them: you strip `.loom/<project>/app/` if you want (~99 MB of build artifact) and `mv .loom/<project>/ orchestrator/evaluation/analytics/<version>/`. Pick `<version>` yourself — anchor is `baseline/`, new iterations start at `1/`, then `2/`, etc.

## How it works

`/weave` writes its fabric into `.loom/<project>/`, including `.eval-orchestrator-pointer` (the Claude Code session UUID for that run).

`analyse.py` walks `analytics/<version>/<run>/`:

- If `usage.jsonl` exists → that run is already analysed, skip.
- If not → read `.eval-orchestrator-pointer`, invoke `transcript-harvest.py --session <uuid>` to extract per-subagent cost rows, then `eval-aggregate.py` to render a human-readable `usage.md`.
- Then pool all rows by version, render `analysis.html`, open it.

**Timing matters.** Claude Code transcripts under `~/.claude/projects/` are local and ephemeral. If you let them age out before running `eval:analyse`, the pointer becomes a dangling reference and the run is reported as missing. This is intentional — the harness doesn't keep a copy.

## Layout

```
orchestrator/evaluation/
├── README.md
├── setup.sh                    ← prerequisite check
├── run-baseline.sh             ← just /weave; no harvest, no aggregate
├── analyze.py                  ← harvest pending + render dashboard
├── chartjs/                    ← vendored Chart.js (no CDN)
├── baseline-seed.md            ← vendored bookmarks seed
├── baseline-answers.yaml       ← canned --answers queue
├── analysis.html               ← rendered output (gitignore-able)
└── analytics/                  ← filed runs, grouped by version
    ├── baseline/
    │   ├── baseline-<ts>-1/    ← moved-in .loom/ fabric
    │   │   ├── usage.jsonl                   (written by analyse)
    │   │   ├── usage.md                      (written by analyse)
    │   │   ├── .eval-orchestrator-pointer    (from /weave, session UUID)
    │   │   └── …                             (seed/spec/design/plan/…)
    │   └── …
    ├── 1/
    └── …
```

## Workflow

### First run

```bash
pnpm run eval:setup
pnpm run eval:run
rm -rf .loom/baseline-<ts>-1/app
mv  .loom/baseline-<ts>-1 orchestrator/evaluation/analytics/baseline/
pnpm run eval:analyse
```

### Next iteration

Make a meaningful loom change, then:

```bash
pnpm run eval:run                              # creates .loom/baseline-<ts2>-1
rm -rf .loom/baseline-<ts2>-1/app
mkdir -p orchestrator/evaluation/analytics/1
mv  .loom/baseline-<ts2>-1 orchestrator/evaluation/analytics/1/
pnpm run eval:analyse
```

(The fabric is always named `baseline-<unix-ts>-<i>` by `run-baseline.sh`. The version label comes from the parent dir you `mv` it into.)

`pnpm run eval:analyse` is idempotent — runs that already have `usage.jsonl` are skipped, only the new dir under `analytics/1/` is harvested.

For pooled runs (`--n 5` or whatever), call `bash orchestrator/evaluation/run-baseline.sh --n 5` directly.

## Row schema

The canonical `usage.jsonl` row shape is defined in `SCHEMA.md` (next to
this README). One row per direct subagent dispatched by `/weave`; rows
group on `phase`. Validate any `usage.jsonl` with:

```bash
python3 orchestrator/evaluation/check-usage-jsonl.py <path-to-usage.jsonl>
```

Exit zero on conformance; non-zero with offending rows on violation.

`status: "crashed"` rows have `tokens: null` and `duration_autonomous_ms: null`,
and are excluded from aggregation means.

Runs filed before the canonical schema landed carry a `PRE_CANONICAL`
marker file in their run directory. `analyze.py` skips those runs when
pooling.

## Known limitations

- **Subagent rows only.** Orchestrator-side inference (mostly Spec's inline answers-queue consumption) is not captured. Roughly constant across runs of the same seed + answers file, so comparison signal is preserved.
- **Build coordinator inline-implements tasks.** The /weave Build coordinator is supposed to dispatch one Task subagent per `T-NNN`; in practice it often implements tasks inline. One big Build row instead of many small ones. Cost is captured; per-task attribution is not.
- **`duration_autonomous_ms` can exceed `duration_wall_ms`** by a few percent on multi-tool-call turns (timestamp-delta over-count). Treat autonomous as comparison-relative, not absolute.
- **No spread / CI.** Means only. A single tail-latency run in a small pool can move a phase mean noticeably.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[analyse] <run>: no .eval-orchestrator-pointer` | You moved a run that wasn't from `/weave`, or stripped the pointer | Recover the UUID, write it into `.eval-orchestrator-pointer`, retry |
| `[analyse] <run>: no rows harvested` | Session no longer in `~/.claude/projects/` (aged out, or different host) | Data is gone; drop the dir |
| `[analyse] warning: no usage rows for run(s): …` | Run dir present in analytics but harvest produced nothing | See the two rows above |
| `eval:run` aborts with "claude CLI not on PATH" | `claude` not installed | Install Claude Code |
