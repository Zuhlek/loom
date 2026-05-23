# `usage.jsonl` — canonical row schema

Regression contract for the per-run usage record produced by the harness.
One row per direct subagent dispatched by `/weave`. Any change to the
shape below is a deliberate schema bump, not drift.

## Row

```json
{
  "phase":                  "<phase enum>" | null,
  "agent_kind":             "subagent",
  "agent_label":            "<label convention>",
  "tokens": {
    "input_tokens":                 <int>,
    "output_tokens":                <int>,
    "cache_creation_input_tokens":  <int>,
    "cache_read_input_tokens":      <int>
  },
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
| `phase` | string enum \| `null` | yes | One of: `spec`, `design`, `plan`, `build`, `review`. May be `null` only when `status == "untagged"`. |
| `agent_kind` | string enum | yes | `subagent`. No other values are emitted. |
| `agent_label` | string | yes | `"{Phase} phase agent"` — `Spec phase agent`, `Design phase agent`, `Plan phase agent`, `Build phase agent`, `Review phase agent`. `"unknown-agent"` when `status == "untagged"`. Human-readable; do not group on it. |
| `tokens` | object \| `null` | yes | Four-key SDK usage object when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `tokens.input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.output_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_creation_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_read_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `duration_wall_ms` | int | yes | Non-negative. Wall-clock dispatch-to-return. |
| `duration_autonomous_ms` | int \| `null` | yes | Non-negative when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `status` | string enum | yes | `ok`, `crashed`, or `untagged`. `crashed` rows are excluded from token totals; their wall is shown in the "Crashed invocations" section of `usage.md`. `untagged` rows are excluded from per-phase rollups and pooled variance — they indicate the PostToolUse hook did not write a `.phase` sidecar for that transcript. |
| `quality` | object \| `null` | yes | Three-key error-count object when `status` is `ok` or `untagged`. `null` when `status == "crashed"`. |
| `quality.error_results` | int | yes when `quality` non-null | Non-negative. Count of `tool_result` rows with `is_error: true`. |
| `quality.read_errors` | int | yes when `quality` non-null | Non-negative. Subset of `error_results` whose originating `tool_use` was the Read tool (matched by `tool_use_id`). |
| `quality.bash_failures` | int | yes when `quality` non-null | Non-negative. Subset of `error_results` whose originating `tool_use` was the Bash tool. |

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

`phase` is sourced from the `agent-<uuid>.phase` sidecar that the
PostToolUse hook in `orchestrator/lib/telemetry/tag-subagent-phase.py` writes next
to each dispatched subagent's transcript. The hook reads the active
project from `.loom/.active` and the current phase from
`.loom/<project>/pipeline.md`'s `Current phase` block, then writes one
sidecar per Agent/Task dispatch. The harvester reads the sidecar
directly — no derivation from transcript content or `meta.json`.

A missing sidecar produces `status: "untagged"` with `phase: null`.
That row is excluded from per-phase rollups; investigate the cause
(hook not registered, `.loom/.active` missing, pipeline.md malformed)
before relying on the run's numbers.

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
