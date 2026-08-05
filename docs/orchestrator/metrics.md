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
- **Cost is a lower bound when `Unpriced rows` is non-zero.** A model with no
  entry in `PRICING_USD_PER_MTOK` yields `cost_usd: null`, which contributes
  nothing to the total. Read the cost columns together with the unpriced
  counters, and add the model to the pricing table to close the gap.

Cost and tokens *are* additive across buckets — each row is distinct spend.

## `usage.jsonl` row schema

One JSON object per line. `schema_version` is `2`.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | int | `2` |
| `phase` | string \| null | `spec`\|`design`\|`plan`\|`build`\|`review` for phase agents, `orchestrator` for the session row, `null` when attribution failed |
| `phase_source` | string \| null | `sidecar` (the hook), `dispatch` (the `Active phase:` stamp in the subagent's own prompt), `parent` (inherited via `meta.json`'s `parentAgentId`), `meta` (fallback: the dispatch description), `session` (orchestrator row) |
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
sessions accumulate.

## How a transcript joins a run

A transcript belongs to a project when **any** of these holds:

1. its session is named in `.session-pointer` (the hook vouched for it);
2. its dispatch prompt carries `Active project: <project>`;
3. an ancestor transcript matched (`meta.json`'s `parentAgentId`);
4. its dispatch text mentions `.loom/<project>` (legacy fallback).

Rule 2 is the load-bearing one, and rule 1 is deliberately not the only one.
`/weave` stamps `Active project:` and `Active phase:` into every dispatch, so
each subagent transcript describes itself; measurement therefore does not
depend on the PostToolUse hook having run in that session. **The pointer
widens the match — it never narrows the search.** Every session under the cwd
is scanned regardless, because a pointer that is missing the session that
actually drove the run would otherwise silence the whole run.

Two failure modes this closes, both observed:

- **The hook never fired.** A session started before the hook was installed,
  or driven by a harness that does not load the user's hook config, produces
  no sidecars and no pointer entry. The run used to be invisible.
- **A bystander claimed the run.** `.loom/.active` is repo-global, so the hook
  fires for *every* Agent dispatch in the repo. An unrelated conversation in
  the same directory used to get written into `.session-pointer` and have its
  ad-hoc agents tagged with whatever phase `pipeline.md` named — producing a
  confident `metrics.md` that measured the wrong conversation. The hook now
  registers a session only when the dispatch carries `Active phase:`, or when
  that session is already in the pointer.

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
| `## Run totals` | Headline row (cost, lifecycle wall span, phase-agent autonomous time, cache hit rate, four token buckets), then provenance (models, row counts measured / untagged / unpriced, coverage) |
| `## Cost by phase` | mermaid `xychart-beta` bar |
| `## Cost share` | mermaid `pie` |
| `## Cache efficiency` | mermaid `xychart-beta` bar, percent axis |
| `## Per-phase detail` | `### Cost & time` (cost, share of run, wall, autonomous) and `### Tokens & quality` (four token buckets, hit rate, three quality counters, unpriced) — one row per bucket in each |
| `## Outcome` | From `outcome.json`: state / phase / verdict / tasks, then the verdict counters |
| `## Crashed invocations` | Header plus totals row when there are none |

An unexpected `phase` value appends a seventh row rather than being folded
away, so attribution gaps stay visible.

Every data table ends in a `**Total**` row. Cost, tokens and the quality
counters are column sums. The two duration columns are **not** — they carry
the same lifecycle-span / phase-agent-autonomous pair as `## Run totals`, for
the reason under *Scope and its limits*: adding the orchestrator's span to the
subagent spans it encloses counts the run twice.

Figures are formatted for a reader — `$162.28`, `43h 11m`, `97.1%`, thousands
separators — and numeric columns are right-aligned. Exact milliseconds and
fractional cents live in `usage.jsonl`, which is the machine-readable copy;
nothing should parse `metrics.md`.

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
python3 orchestrator/lib/telemetry/test_tag_subagent_phase.py
```

The renderer suite asserts the fixed-shape contract against zero-data input —
that is where a conditional section would show itself — and checks mermaid
fence validity for the degenerate inputs. The harvest suite covers the
hook-less run (dispatch-stamp attribution, parent inheritance, a pointer that
names the wrong session) and out-of-order transcript timestamps. The hook
suite covers the bystander gate on `.session-pointer`.
