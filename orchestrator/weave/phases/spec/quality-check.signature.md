# Spec Quality Check Agent — Signature

I/O signature between `/weave` and the Spec Quality Check Agent (in-phase, narrow scope).

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Spec rerun-or-continue surface. Not part of the mandatory phase cycle. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`. Spec QC is narrower than the cross-phase Pre-Build QC (Plan→Build gate); this agent audits only `spec.md` + `decisions.md`.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Spec RETURN block | passed by orchestrator | yes | The just-completed Spec RETURN block |
| `spec.md` | `.loom/<project>/spec.md` | yes | Spec-phase intent |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Spec-phase decisions |

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
