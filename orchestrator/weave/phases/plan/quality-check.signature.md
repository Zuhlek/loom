# Pre-Build Quality Check Agent — Signature

I/O signature between `/weave` and the Pre-Build Quality Check Agent (the lifecycle's cross-phase comprehensive quality gate; complements the narrower in-phase QCs at Spec, Design, and Build).

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** Dispatched only when the user picks `Run quality check` at the Plan rerun-or-continue surface. Not part of the mandatory phase cycle. Complements the narrower in-phase QCs at `phases/spec/quality-check.md`, `phases/design/quality-check.md`, and `phases/build/quality-check.md` — this Plan QC is the only one that audits across phase boundaries. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`.

## Params

The agent audits every artifact produced by Spec, Design, and Plan — they are all "the pre-Build state" and all in scope.

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| Plan RETURN block | passed by orchestrator | yes | The just-completed Plan RETURN block |
| `spec.md` | `.loom/<project>/spec.md` | yes | Spec-phase intent (audited for gaps, open ambiguity, decision drift) |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Spec-phase decisions (audited for slot/story consistency) |
| `design.md` | `.loom/<project>/design.md` | yes | Design-phase structure (audited for realisation gaps and ADR completeness) |
| `plan.md` | `.loom/<project>/plan.md` | yes | Plan-phase narrative (incl. `Verification environment`) |
| `board.md` | `.loom/<project>/board.md` | yes | Plan-phase board |
| `task.md` | `.loom/<project>/task.md` | yes | Plan-phase task index |
| `tests.md` | `.loom/<project>/tests.md` | yes | Plan-phase test strategy + mutation opt-in |
| `tasks/T-*.md` | `.loom/<project>/tasks/T-*.md` | yes | Per-task definitions |
| `ticket.md` | `.loom/<project>/ticket.md` | optional | Plan-phase optional write |

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
- Shape per `quality-check.md` › "Output: `quality-review.md`".

#### `pipeline.md` updates

- Path: `.loom/<project>/pipeline.md`.
- Updates the sections `Quality findings`, `Pending user input`, `Next valid action`.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `passed` | No findings; the agent recommends `Continue` | Surface `Continue` recommendation alongside the findings preview |
| `findings` | One or more findings of varying severity | Surface the findings preview; let the user pick `Continue` or `Refine` |
| Param missing on disk | Producer's declared write is absent or shape-failed | Orchestrator surfaces a param-validation failure without invoking the audit body |
