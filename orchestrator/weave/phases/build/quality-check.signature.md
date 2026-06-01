# Build Quality Check Agent — Signature

I/O signature between `/weave` and the Build Quality Check Agent (in-phase, narrow scope).

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Build Refine-or-Continue surface. Not part of the mandatory phase cycle. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`. Build QC is narrower than the Review phase audit; this agent audits only the just-completed Build session's evidence artifacts and the working-tree diff, not intent satisfaction or design conformance.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Build RETURN block | passed by orchestrator | yes | The just-completed Build RETURN block |
| `principles.md` | `methods/principles.md` (inlined into dispatch head) | yes | Engineering principles P1–P7 |
| `test-report.md` | `.loom/<project>/test-report.md` | yes | Aggregated test evidence |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | conditional | Smoke evidence (present when the project is runnable) |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-NNN.done.md` | yes | Per-task done reports |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-NNN.test-log.txt` | yes | Per-task red/green test output |
| Working-tree diff | passed by orchestrator | yes | The Build session's repository changes |

## Returns

### RETURN block

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
    enum: [continue, refine]
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
- Shape per `quality-check.md` › cross-reference to `methods/quality-check-protocol.md`.

#### `pipeline.md` updates

- Path: `.loom/<project>/pipeline.md`.
- Updates the sections `Quality findings`, `Pending user input`, `Next valid action`.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `passed` | No findings; agent recommends `Continue` | Surface `Continue` recommendation alongside the findings preview |
| `findings` | One or more findings of varying severity | Surface the findings preview; let the user pick `Continue` or `Refine` |
| Param missing on disk | Producer's declared write is absent or shape-failed | Orchestrator surfaces a param-validation failure without invoking the audit body |
