# Run metrics

Every `/weave` run carries `metrics.md` in its workspace: what the lifecycle
cost, per phase, with charts. It is machine-generated and refreshed as the run
goes — there is no separate measurement command to remember.

## What produces it

| Step | Script | Trigger |
| --- | --- | --- |
| Tag | `lib/telemetry/tag-subagent-phase.py` | PostToolUse on `Agent`\|`Task` — writes the `.phase` sidecar, then runs the three steps below |
| Harvest | `lib/telemetry/transcript-harvest.py` | → `usage.jsonl` |
| Outcome | `lib/telemetry/run-outcome.py` | → `outcome.json` |
| Render | `lib/telemetry/render-metrics.py` | → `metrics.md` |

The hook fires *after* each dispatched subagent returns, so the refresh that
follows the Review agent includes the Review agent's own row. The orchestrator
runs the renderer once more on the Review→complete transition (`SKILL.md` Phase
Cycle step 4) so the final file on disk is the complete one.

Hook wiring lives in `hooks.md`. Without the hook, no measurement is produced
and the Review phase returns `blocked` naming the missing file.

## Scope and its limits

Measurement covers the whole lifecycle — the five phase agents **and** the
`/weave` orchestrator's own session. The orchestrator is not a rounding error:
on a representative run it is roughly a third of total spend, so a
subagent-only number understates cost badly.

Three properties follow from how the data is collected. None is a defect; all
three change how you read the file:

- **The orchestrator row is complete-minus-tail.** Its session is still open
  when the file is written, so the gate turns and the lifecycle-complete write
  are uncounted.
- **Durations do not add across buckets.** The orchestrator's span encloses the
  subagent spans it dispatched. `metrics.md` therefore reports wall as the
  enclosing lifecycle span, and autonomous time summed over the phase agents
  only.
- **Cost is an estimate.** It is derived from token counts at list prices, with
  exact 5m/1h cache-write multipliers. It tracks the billed figure closely but
  is not it.

Cost and tokens *are* additive across buckets — each row is distinct spend.

## `usage.jsonl` row schema

One JSON object per line. `schema_version` is `2`.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | int | `2` |
| `phase` | string \| null | `spec`\|`design`\|`plan`\|`build`\|`review` for phase agents, `orchestrator` for the session row, `null` when attribution failed |
| `phase_source` | string \| null | `sidecar` (the hook), `meta` (fallback: the dispatch description), `session` (orchestrator row) |
| `agent_kind` | string | `subagent` \| `orchestrator` |
| `agent_label` | string | e.g. `Build phase agent`, `Weave orchestrator`, `unknown-agent` |
| `model` | string \| null | Dominant model across the transcript's messages |
| `tokens` | object \| null | `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. `null` marks a crash sentinel |
| `cost_usd` | float \| null | Estimated. `null` when any token-bearing message's model has no pricing entry |
| `duration_wall_ms` | int | First to last timestamped row |
| `duration_autonomous_ms` | int \| null | Timeline segments closed by an assistant row; guaranteed ≤ wall |
| `status` | string | `ok` \| `untagged` (no phase resolved) \| `crashed` (no usage block in the whole transcript) |
| `quality` | object \| null | `error_results`, `read_errors`, `bash_failures`; `null` on a crashed row |

Two measurement contracts are load-bearing and easy to get wrong if you rewrite
the reducer:

- **Token sums deduplicate by `message.id`.** Claude Code writes one transcript
  row per *content block* of an API response, each repeating that response's
  cumulative usage. Naive per-row summation over-counts 2–4×; the harvester
  keeps the last row per id.
- **Autonomous time partitions the timeline.** Each timestamped row closes the
  segment since the previous one, and only segments closed by an assistant row
  count. This is what keeps autonomous ≤ wall, and what keeps a subagent's
  run-time out of the orchestrator's autonomous total.

## Transcript layout

```
~/.claude/projects/<encoded-cwd>/<session>.jsonl            ← orchestrator row
~/.claude/projects/<encoded-cwd>/<session>/subagents/
    agent-<uuid>.jsonl                                      ← one subagent row
    agent-<uuid>.phase                                      ← hook-written tag
    agent-<uuid>.meta.json                                  ← fallback tag source
```

`<encoded-cwd>` replaces `/` and spaces with `-`. A workspace's
`.session-pointer` holds one session UUID per line — retries and resumed
sessions accumulate — and is how a refresh finds the right sessions without
depending on dispatch-text matching.

Claude Code transcripts are ephemeral. Once a session directory is pruned, a
run's numbers can no longer be re-derived; `metrics.md` is the durable record.

## `outcome.json`

```json
{
  "lifecycle_state":         "active" | "complete",
  "final_phase":             "spec" | "design" | "plan" | "build" | "review",
  "review_findings_present": true | false,
  "pipeline_md_present":     true | false,
  "review_verdict": { "status": "PASS" | "FAIL", "blockers": 0, "major": 0,
                      "minor": 0, "note": 0 },
  "tasks": { "planned": 0, "done": 0 }
}
```

Derived from `pipeline.md`, `review-verdict.json` (falling back to the
`**PASS|FAIL**` line in `review.md`), and `board.md`.

## `metrics.md` layout

Fixed. Every section renders on every run, all six buckets render whether or
not they carry data, and a zero is a `0` — so two runs differ in their numbers
and nothing else, and `diff` between runs is meaningful.

| Section | Content |
| --- | --- |
| `## Run totals` | Cost, lifecycle wall span, phase-agent autonomous time, four token buckets, cache hit rate, models, row counts, coverage |
| `## Cost by phase` | mermaid `xychart-beta` bar |
| `## Cost share` | mermaid `pie` |
| `## Cache efficiency` | mermaid `xychart-beta` bar |
| `## Per-phase detail` | One row per bucket: `spec`, `design`, `plan`, `build`, `review`, `orchestrator` |
| `## Outcome` | From `outcome.json` |
| `## Crashed invocations` | Header-only when there are none |

An unexpected `phase` value appends a seventh row rather than being folded
away, so attribution gaps stay visible.

Charts are mermaid because the loom UI renders it natively
(`ui/apps/web/src/components/fabric/MermaidBlock.tsx`) and GitHub renders it
inline. The renderer guards the two degenerate cases that produce an invalid
fence: an all-zero bar series (the y-axis floor is 1) and an all-zero pie
(which would divide by zero, and falls back to a placeholder slice).

## Ownership

`metrics.md` belongs to the Review phase by contract
(`phases/review/phase.signature.md § Writes`), but no agent writes it. Review's
duty is to verify it exists and cite its path; it never types a figure into
`review.md`. A cost an agent typed is a number nobody can reproduce — the file
is the citable source.

## Running the renderer by hand

```bash
python3 orchestrator/lib/telemetry/render-metrics.py <project> --loom-root .loom
python3 orchestrator/lib/telemetry/transcript-harvest.py <project> --dry-run
```

`--dry-run` on the harvester reports the rows it would emit without writing.

## Tests

```bash
python3 orchestrator/lib/telemetry/test_render_metrics.py
python3 orchestrator/lib/telemetry/test_transcript_harvest_session.py
```

The renderer suite asserts the fixed-shape contract against zero-data input —
that is where a conditional section would show itself — and checks mermaid
fence validity for the degenerate inputs.
