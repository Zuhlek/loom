# Design Quality Check Agent — Signature

I/O signature between `/weave` and the Design Quality Check Agent (in-phase, narrow scope).

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Design rerun-or-continue surface. Not part of the mandatory phase cycle. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`. Design QC is narrower than the cross-phase Pre-Build QC (Plan→Build gate); this agent audits only `design.md` (+ optional `mockup/`).

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Design RETURN block | passed by orchestrator | yes | The just-completed Design RETURN block |
| `design.md` | `.loom/<project>/design.md` | yes | Design-phase structure |
| `mockup/` | `.loom/<project>/mockup/` | optional | Design-phase mockup evidence (when produced) |

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
