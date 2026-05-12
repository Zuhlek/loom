# Design Quality Check Agent — Signature

I/O signature between `/weave` and the Design Quality Check Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Design rerun-or-continue surface. Not part of the mandatory phase cycle. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `quality-check.md` and this signature.

## Params

Includes every file from the producer phase's `phase.signature.md` › `## Returns.Writes` (the param-validation interface).

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Design RETURN block | passed by orchestrator | yes | The just-completed Design RETURN block |
| `design.md` | `.loom/<project>/design.md` | yes | Producer's write (read-only) — drawn from Design's `phase.signature.md.Returns.Writes` |
| `mockup/feedback.md` | `.loom/<project>/mockup/feedback.md` | conditional | Producer's optional write when a mockup influenced structure |
| `spec.md` | `.loom/<project>/spec.md` | yes | Read-only cross-reference for coverage / duplication checks |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Read-only cross-reference for "decisions addressed" check |

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
