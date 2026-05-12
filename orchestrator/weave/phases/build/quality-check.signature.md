# Build Quality Check Agent — Signature

I/O signature between `/weave` and the Build Quality Check Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Build rerun-or-continue surface. Not part of the mandatory phase cycle. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `quality-check.md` and this signature.

## Params

Includes every file from the producer phase's `phase.signature.md` › `## Returns.Writes` (the param-validation interface).

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Build RETURN block | passed by orchestrator | yes | The just-completed Build RETURN block |
| `board.md` | `.loom/<project>/board.md` | yes | Producer's write — current task transitions |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-*.test-log.txt` | yes | Producer's per-task red+green logs |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-*.done.md` | yes | Producer's per-task done reports |
| `test-report.md` | `.loom/<project>/test-report.md` | yes | Producer's aggregated verification |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | conditional | Producer's conditional write (when runnable) |
| `develop-log.md` | `.loom/<project>/develop-log.md` | yes | Producer's write |
| `tasks/T-*.md` | `.loom/<project>/tasks/T-*.md` | yes | Plan-produced task specs (read-only cross-reference for scope integrity) |
| `design.md` | `.loom/<project>/design.md` | yes | Read-only cross-reference (runnability) |
| `plan.md` | `.loom/<project>/plan.md` | yes | Read-only cross-reference |

## Returns

### Return block

```yaml
type: object
required: [phase, status, summary, recommendation, findings, artifacts]
properties:
  phase:
    enum: [quality-check]
  status:
    enum: [passed, findings]
  summary:
    type: string
  recommendation:
    enum: [continue, rerun]
  findings:
    type: array
    items:
      type: object
      required: [severity, title]
      properties:
        severity:
          enum: [blocker, major, minor, note]
        title:
          type: string
        suggested-focus:
          type: string
  artifacts:
    type: array
    items:
      type: string
```

### Writes

#### `quality-review.md`

- Path: `.loom/<project>/quality-review.md`.
- Overwritten on each Quality Check run.
- Shape per `quality-check.md` › "Output: `quality-review.md`".

#### `pipeline.md` updates

- Path: `.loom/<project>/pipeline.md`.
- Updates the sections `Quality findings`, `Pending user input`, `Next valid action`.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `passed` | No findings; the agent recommends `Continue` | Surface `Continue` recommendation alongside the findings preview |
| `findings` | One or more findings of varying severity | Surface the findings preview; let the user pick `Continue` or `Rerun phase` |
| Param missing on disk | Producer's declared write is absent or shape-failed | Orchestrator surfaces a param-validation failure without invoking the audit body |
