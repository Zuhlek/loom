# Loom evaluation harness — runbook

Measure what a `/weave` run costs, and compare across loom versions.

## Two commands

```bash
pnpm run eval:pool                         # 5 iterations, filed under analytics/<version>/
pnpm run eval:analyse                      # (re)render analysis.html from filed runs
```

`eval:run` (one iteration) and `eval:pool` (five) both accept the same flags
as `run-baseline.sh`:

```bash
bash orchestrator/evaluation/run-baseline.sh --n 5 --version 2 --model claude-fable-5
```

`--version LABEL` files each finished run straight into
`analytics/<LABEL>/` (stripping the ~99 MB `app/` first, unless
`--keep-app`). Omit it to leave runs under `.loom/` for manual filing. The
anchor version is `baseline`; iterations are `1`, `2`, … (zero-pad past 9).

## What each run produces

Every run — eval **and** regular interactive `/weave` — carries the same
usage artifacts, so a workspace doubles as its own usage summary:

- `usage.jsonl` — one row per dispatched subagent (schema in `SCHEMA.md`).
- `usage.md` — human-readable per-phase rollup with an **estimated cost**
  column, run totals, model(s), and untagged-row count.
- `outcome.json` — lifecycle state, final phase, review verdict, task counts.
- `run-meta.json` (eval runs only) — **authoritative** whole-run cost /
  turns / duration from `claude --print --output-format json`, plus the
  confounders that decide comparability: model(s), claude CLI version, loom
  git SHA, seed/answers hashes, attempt count, terminal status.

For interactive runs these are refreshed by the PostToolUse hook after every
subagent returns; for eval runs by `run-baseline.sh` in-loop after each
iteration.

## Reliability: how the harness avoids the old failure modes

- **Session UUID chosen up front.** `run-baseline.sh` picks the Claude Code
  session id, writes it to `.eval-orchestrator-pointer` *before* `/weave`
  starts, and passes `--session-id`. Harvesting never depends on the hook
  having fired. Retries `--resume` the same session, so their subagents land
  in the same transcripts dir and are captured (v1 lost every retry).
- **Bounded, non-interactive, machine-independent.** Each attempt runs under
  `timeout` with explicit `--permission-mode bypassPermissions`, so a stuck
  or permission-blocked run cannot hang the harness and behaviour does not
  depend on the machine's `~/.claude/settings.json`.
- **Harvest in-loop.** Claude transcripts under `~/.claude/projects/` are
  ephemeral; the harness harvests immediately after each iteration rather
  than at some later `analyse` time, closing the data-loss window.
- **No cross-session contention.** A `.eval-run` marker in the workspace
  keeps `auto-advance` in unrelated interactive sessions from adopting an
  eval project (and vice-versa).

## Reading the dashboard

`analysis.html` leads with **estimated cost (USD)** — the headline trend
metric, because it stays comparable when a change shifts the token mix
between buckets that differ ~12× in price. Charts show the per-version
**median** with **per-run dots** overlaid, so a small pool's spread is
visible instead of hidden behind a mean. A red **comparability-warnings**
banner appears when a version pools runs across different models, CLI
versions, or loom SHAs, or contains untagged / incomplete runs — treat any
delta under such a banner as suspect.

Treat sub-20–30% deltas at n≈3–5 as noise.

## How analyse works

`analyze.py` walks `analytics/<version>/<run>/`:

- `usage.jsonl` present → already harvested, skip.
- absent → read every session id in `.eval-orchestrator-pointer` and
  `transcript-harvest.py --session <uuid>` (one per line) to extract rows,
  then `eval-aggregate.py` for `usage.md`.
- Runs marked `PRE_CANONICAL` (pre-schema-v2, inflated numbers) are skipped.
- Pool rows by version → render `analysis.html`.

**Timing still matters for manual filing.** If you file a run long after it
ran and its transcripts have aged out, harvest produces nothing and the run
is reported missing. `eval:pool --version` harvests in-loop, so this only
bites hand-filed runs.

## Layout

```
orchestrator/evaluation/
├── setup.sh                    ← prerequisite check
├── run-baseline.sh             ← drive /weave, capture telemetry, file runs
├── analyze.py                  ← harvest pending + render dashboard
├── check-usage-jsonl.py        ← validate usage.jsonl / outcome.json against SCHEMA.md
├── chartjs/                    ← vendored Chart.js (no CDN)
├── baseline-seed.md            ← vendored bookmarks seed
├── baseline-answers.yaml       ← canned answer queue
├── analysis.html               ← rendered output (gitignore-able)
└── analytics/                  ← filed runs, grouped by version
    ├── baseline/<run>/…
    └── 1/<run>/…
```

Telemetry engine lives in `orchestrator/lib/telemetry/`:
`transcript-harvest.py`, `eval-aggregate.py`, `run-outcome.py`,
`tag-subagent-phase.py`.

## Row schema & validation

The canonical `usage.jsonl` row shape (schema_version 2) is in
`orchestrator/evaluation/SCHEMA.md`. Validate any run with:

```bash
python3 orchestrator/evaluation/check-usage-jsonl.py <path-to-usage.jsonl>
python3 orchestrator/evaluation/check-usage-jsonl.py --outcome <path-to-outcome.json>
```

Exit zero on conformance; non-zero with offending rows on violation. The
validator rejects rows lacking `schema_version: 2` and any row whose
`duration_autonomous_ms` exceeds `duration_wall_ms`.

## Known limitations

- **Subagent rows only.** Per-subagent `cost_usd` in `usage.jsonl` excludes
  orchestrator-side inference. The authoritative whole-run cost (incl.
  orchestrator) is `run-meta.json.total_cost_usd`.
- **Build is one row per phase entry.** The Build phase agent walks the task
  graph within a single session, so `usage.jsonl` carries one Build row per
  dispatch, not one per task. Aggregate Build cost is exact; per-task
  attribution is not extractable.
- **`cost_usd` is an estimate.** Priced from a checked-in per-model table
  (`transcript-harvest.py`). Cross-check absolute figures against
  `run-meta.json.total_cost_usd`, which comes straight from the API result.
- **Small-n.** Medians over n≈3–5 with per-run dots — no confidence
  intervals. Grow the pool for a tighter read.

## Rubric grader (planned, not yet built)

Cost/latency answer "did it get cheaper"; they do not answer "is it still
correct". The per-seed rubric under `rubrics/` is the human checklist today;
the automated grader + no-skill control run described in `rubrics/README.md`
remain the next step to turn this from a cost meter into an eval.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `no .eval-orchestrator-pointer` | Run wasn't from `run-baseline.sh`, or the pointer was stripped | Recover the session UUID(s), write one per line into `.eval-orchestrator-pointer`, retry |
| `no rows harvested` | Session aged out of `~/.claude/projects/` | Data is gone; drop the dir |
| Many rows `phase_source: "meta"` (or `untagged`) | PostToolUse phase hook not firing | Ensure the hook matcher is `Agent\|Task` and points at `orchestrator/lib/telemetry/tag-subagent-phase.py`; run with `claude --debug` to see hook stderr |
| Row rejected: `schema_version` | Pre-v2 run | Re-harvest if transcripts survive, else mark the dir `PRE_CANONICAL` |
| Dashboard shows a comparability warning | Pool mixes models / CLI versions / SHAs, or has incomplete runs | Re-run so the pool is homogeneous before trusting the delta |
| `eval:run` aborts: "claude CLI not on PATH" | `claude` not installed | Install Claude Code |
| Attempt marked `timeout` in run-meta | Run exceeded `--timeout-mins` | Raise the cap, or investigate the stuck phase in `.eval-logs/` |
