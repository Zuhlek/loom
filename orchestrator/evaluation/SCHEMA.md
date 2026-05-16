# `usage.jsonl` — canonical row schema

Regression contract for the per-run usage record produced by the harness.
One row per direct subagent dispatched by `/weave`. Any change to the
shape below is a deliberate schema bump, not drift.

## Row

```json
{
  "phase":                  "<phase enum>",
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
  "status":                 "ok" | "crashed"
}
```

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phase` | string enum | yes | One of: `spec`, `design`, `plan`, `build`, `review`. Never `null`, never empty. |
| `agent_kind` | string enum | yes | `subagent`. No other values are emitted. |
| `agent_label` | string | yes | `"{Phase} phase agent"` — `Spec phase agent`, `Design phase agent`, `Plan phase agent`, `Build phase agent`, `Review phase agent`. Human-readable; do not group on it. |
| `tokens` | object \| `null` | yes | Four-key SDK usage object when `status == "ok"`. `null` when `status == "crashed"`. |
| `tokens.input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.output_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_creation_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `tokens.cache_read_input_tokens` | int | yes when `tokens` non-null | Non-negative. |
| `duration_wall_ms` | int | yes | Non-negative. Wall-clock dispatch-to-return. |
| `duration_autonomous_ms` | int \| `null` | yes | Non-negative when set. `null` when `status == "crashed"`. |
| `status` | string enum | yes | `ok` or `crashed`. Crashed rows are excluded from token totals; their wall is shown in the "Crashed invocations" section of `usage.md`. |

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

## Validation

`orchestrator/evaluation/check-usage-jsonl.py <path>` validates a file
against this contract. Exit code zero on conformance, non-zero on any
violation with offending rows printed to stderr.
