# `usage.jsonl` — canonical row schema (schema_version 2)

Regression contract for the per-run usage record produced by the harness.
One row per direct subagent dispatched by `/weave`. Any change to the
shape below is a deliberate schema bump, not drift.

## Measurement contract (why v2 exists)

Claude Code writes **one transcript row per content block** of the same API
response, and every row repeats that response's cumulative `usage`. The v1
harvester summed `usage` over all assistant rows, over-counting tokens
**2–4× by a factor that varied per run** (it equals the average
content-blocks-per-response), which made cross-version trends meaningless.
v2 fixes three things:

- **Tokens deduplicate by `message.id`**, keeping the last (final) row per
  API message.
- **`duration_autonomous_ms` partitions the timeline** — each timestamped
  row closes the segment since the previous one; assistant-closed segments
  count as generation time. This guarantees `autonomous ≤ wall` (v1 could
  report 2× wall).
- **Each row carries `model` and an estimated `cost_usd`** priced per model
  with exact 5m/1h cache-write multipliers.

Runs harvested before v2 carry no `schema_version` and are rejected by the
validator; the analyzer skips them via a `PRE_CANONICAL` marker.

## Row

```json
{
  "schema_version":         2,
  "phase":                  "<phase enum>" | null,
  "phase_source":           "sidecar" | "meta" | null,
  "agent_kind":             "subagent",
  "agent_label":            "<label convention>",
  "model":                  "<model id>" | null,
  "tokens": {
    "input_tokens":                 <int>,
    "output_tokens":                <int>,
    "cache_creation_input_tokens":  <int>,
    "cache_read_input_tokens":      <int>
  },
  "cost_usd":               <float|null>,
  "duration_wall_ms":       <int>,
  "duration_autonomous_ms": <int|null>,
  "status":                 "ok" | "crashed" | "untagged",
  "quality": {
    "error_results":  <int>,
    "read_errors":    <int>,
    "bash_failures":  <int>
  }
}
```

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `schema_version` | int | yes | Must be `2`. Bumps are deliberate; the validator rejects any other value (including its absence). |
| `phase` | string enum \| `null` | yes | One of: `spec`, `design`, `plan`, `build`, `review`. May be `null` only when `status == "untagged"`. |
| `phase_source` | string enum \| `null` | yes | `sidecar` (from the PostToolUse `.phase` file — authoritative) or `meta` (fallback from the `agent-<uuid>.meta.json` dispatch description when the hook did not write a sidecar). `null` when `phase` is `null`. A run with many `meta`-sourced rows means the phase hook is misconfigured. |
| `agent_kind` | string enum | yes | `subagent`. No other values are emitted. |
| `agent_label` | string | yes | `"{Phase} phase agent"` — `Spec phase agent`, `Design phase agent`, `Plan phase agent`, `Build phase agent`, `Review phase agent`. `"unknown-agent"` when `status == "untagged"`. Human-readable; do not group on it. |
| `model` | string \| `null` | yes | Dominant real model id across the transcript's API messages. `null` when `status == "crashed"` or no model could be determined. |
| `tokens` | object \| `null` | yes | Four-key SDK usage object (deduplicated by message id) when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `tokens.input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.output_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_creation_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_read_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `cost_usd` | float \| `null` | yes | Estimated USD cost of this subagent, priced per `model` (cache writes at 1.25×/2× by TTL, reads at 0.1×). `null` when `status == "crashed"` or the model has no pricing entry. A per-subagent estimate — the authoritative whole-run cost (incl. orchestrator) is `run-meta.json.total_cost_usd`. |
| `duration_wall_ms` | int | yes | Non-negative. Wall-clock dispatch-to-return. |
| `duration_autonomous_ms` | int \| `null` | yes | Non-negative and **≤ `duration_wall_ms`** when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `status` | string enum | yes | `ok`, `crashed`, or `untagged`. `crashed` rows are excluded from token totals; their wall is shown in the "Crashed invocations" section of `usage.md`. `untagged` rows are excluded from per-phase rollups and pooled variance — they indicate no phase could be resolved (neither `.phase` sidecar nor a phase-bearing `meta.json` description). |
| `quality` | object \| `null` | yes | Three-key error-count object when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `quality.error_results` | int | yes when `quality` non-null | Non-negative. Count of `tool_result` rows with `is_error: true`. |
| `quality.read_errors` | int | yes when `quality` non-null | Non-negative. Subset of `error_results` whose originating `tool_use` was the Read tool (matched by `tool_use_id`). |
| `quality.bash_failures` | int | yes when `quality` non-null | Non-negative. Subset of `error_results` whose originating `tool_use` was the Bash tool. |

## `run-meta.json`

Written by `run-baseline.sh` per run — the authoritative confounder record
and whole-run totals (from `claude --print --output-format json`). Trends
across versions are only comparable when `models`, `claude_version`, and
`loom_git_sha` match, and `failed` is `false`.

| Field | Notes |
| --- | --- |
| `total_cost_usd` | Authoritative whole-run cost (all attempts), incl. orchestrator inference. `null` if no attempt reported cost. |
| `num_turns`, `duration_ms` | Summed across attempts. |
| `session_ids` | Every Claude Code session the run used (retries `--resume` the first). |
| `models`, `model_flag` | Models observed in the result `modelUsage`, and the `--model` flag if pinned. |
| `claude_version`, `loom_git_sha`, `loom_git_dirty` | Confounders. A pool mixing these is flagged in the dashboard. |
| `seed_sha256`, `answers_sha256` | Fixed-input hashes — a changed seed/answers file is a different benchmark. |
| `attempts`, `failed`, `failure_reason` | Retry count and terminal status (`timeout`, `claude_exit_N`, `max_attempts`, `pipeline_missing`). |
| `attempt_results[]` | Per-attempt `session_id` / `total_cost_usd` / `num_turns` / `duration_ms` / `is_error`. |

## Quality signal sources

`quality` is extracted from the same transcript JSONL the harvester
already walks. The function is pure over the row list and performs no
I/O.

The bash-failure signal is `is_error: true` on a `tool_result` row whose
originating `tool_use` (matched by `tool_use_id`) is named `Bash`.
Claude Code renders such results with `content` beginning `Exit code N\n`
followed by combined stdout/stderr, but the `is_error` flag is the
authoritative marker — the `Exit code` prefix is a presentation detail
of the result body and is not parsed.

Read errors use the same `tool_use_id` correlation against the `Read`
tool name. Any Read error counts (file missing, permission denied,
size-limit exceeded, decode error).

## Phase tagging

`phase` is sourced first from the `agent-<uuid>.phase` sidecar that the
PostToolUse hook in `orchestrator/lib/telemetry/tag-subagent-phase.py` writes next
to each dispatched subagent's transcript (`phase_source: "sidecar"`). The
hook reads the active project from `.loom/.active` and the phase from the
dispatched prompt's `Active phase:` reminder (falling back to
`.loom/<project>/pipeline.md`'s `Current phase` block), then writes one
sidecar per Agent/Task dispatch.

When no sidecar is present, the harvester falls back to the dispatch
`description` in the sibling `agent-<uuid>.meta.json` (e.g. "Spec phase for
…") and tags the row `phase_source: "meta"`. This degrades a
hook-misconfiguration to a heuristic instead of dropping the row.

Only when neither yields a phase does the row become `status: "untagged"`
with `phase: null` and `phase_source: null` — excluded from per-phase
rollups. Investigate the cause (hook not registered — the PostToolUse
matcher must be `Agent|Task` and point at `lib/telemetry/`; `.loom/.active`
missing; pipeline.md malformed) before relying on the run's numbers.

## Grouping

The stable cross-run grouping key is `phase`. `agent_label` is
human-readable text only. The wave's per-phase rollup in `usage.md` and
the cross-version analyzer (`analyze.py`) both group on `phase`.

## Orchestrator rows

`agent_kind: "orchestrator"` rows are **not** emitted by the current
harness. The orchestrator's own `/weave` session inference (notably the
Spec inline answers-queue consumer) is not captured in `usage.jsonl`. For
comparison across runs of the same seed + answers file the orchestrator
cost is approximately constant per phase, so per-phase deltas across loom
versions remain meaningful. Re-introducing orchestrator rows is a
forward-compatible schema extension: `agent_kind == "orchestrator"`
already has reader support in `eval-aggregate.py`'s split column, so
adding emission later would not break existing consumers.

## `outcome.json`

Per-run lifecycle and fabric-presence summary, written alongside
`usage.jsonl` at analyze time. Captures what per-phase rows alone do not.

```json
{
  "lifecycle_state":         "active" | "complete",
  "final_phase":             "<phase enum>" | null,
  "review_findings_present": true | false,
  "pipeline_md_present":     true | false,
  "review_verdict": {
    "status":   "PASS" | "FAIL",
    "blockers": <int>,
    "major":    <int>,
    "minor":    <int>,
    "note":     <int>
  } | null,
  "tasks": {
    "planned": <int>,
    "done":    <int>
  } | null
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `lifecycle_state` | string enum | yes | Parsed from `Lifecycle state` block of `pipeline.md`. Falls back to `"active"` when `pipeline.md` is missing or the block is empty. |
| `final_phase` | string enum \| `null` | yes | Parsed from `Current phase` block of `pipeline.md`. `null` when missing. |
| `review_findings_present` | bool | yes | True iff `review.md` exists in the run dir. |
| `pipeline_md_present` | bool | yes | True iff `pipeline.md` exists in the run dir. |
| `review_verdict` | object \| `null` | yes | Read from `.loom/<project>/review-verdict.json` (canonical, written by the Review phase agent — see `phases/review/phase.signature.md ## Writes`). Falls back to parsing the first `**PASS\|FAIL** — N Blockers, N Major, N Minor, N Notes` line in `review.md` when the sidecar is absent. `null` when neither yields a valid verdict. |
| `review_verdict.status` | string enum | yes when `review_verdict` non-null | `PASS` or `FAIL`. |
| `review_verdict.blockers` | int | yes when `review_verdict` non-null | Non-negative. |
| `review_verdict.major` | int | yes when `review_verdict` non-null | Non-negative. |
| `review_verdict.minor` | int | yes when `review_verdict` non-null | Non-negative. |
| `review_verdict.note` | int | yes when `review_verdict` non-null | Non-negative. |
| `tasks` | object \| `null` | yes | Parsed from `board.md` section bullets (`## Backlog`, `## In Progress`, `## Review`, `## Done`). `null` when `board.md` is absent or has no `## <Section>` headings or has zero `- T-NNN` bullets total. |
| `tasks.planned` | int | yes when `tasks` non-null | Total `- T-NNN` bullets across all four sections. Non-negative. |
| `tasks.done` | int | yes when `tasks` non-null | `- T-NNN` bullets under `## Done`. Non-negative; never exceeds `planned`. |

## Validation

`orchestrator/evaluation/check-usage-jsonl.py <path>` validates a
`usage.jsonl` file against the row contract. `--outcome <path>` validates
an `outcome.json` file in place of (or in addition to) usage rows. Exit
code zero on conformance, non-zero on any violation with offending rows
printed to stderr.
