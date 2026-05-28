# Review Audit Agent — Signature

I/O signature between `/weave` and the Review Audit Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == review` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`; resolve `<project>` / `<phase>` / `<task>` placeholders by reading the `<system-reminder>` tail block. Review has no quality-check agent — Review IS the project-level quality check.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| All phase artifacts | `.loom/<project>/{spec,design,plan,board,task,tests}.md` | yes | Read-only |
| `test-report.md` | `.loom/<project>/test-report.md` | yes | Aggregated verification — canonical Build-evidence summary; the primary source the agent reads for test-evidence findings |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | conditional | When Build ran smoke-test |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-NNN.done.md` | on-demand | Per-task done reports — open only when a finding references a specific task |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-NNN.test-log.txt` | on-demand | Per-task test logs — open only when a finding references a specific task |
| Repository diff | working tree | yes | Code under review |
| `principles.md` | `methods/principles.md` (inlined into dispatch head) | yes | Engineering principles |
| `type-guidance.md` | `.loom/<project>/type-guidance.md` | when typed | Domain guidance (materialized at project creation from the active `types/<type>.md`) |

### State preconditions

- `pipeline.md.Current phase` is `review`.
- Build-phase artifacts exist (`test-report.md` and per-task done reports).

## Returns

### Return block

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity, blockers, major, minor]
properties:
  phase:
    enum: [review]
  status:
    enum: [Pending, blocked, failed, complete]
  artifacts:
    type: array
    items:
      type: string
  summary:
    type: string
  open-ambiguity:
    type: array
    items:
      type: object
  blockers:
    type: integer
  major:
    type: integer
  minor:
    type: integer
```

Success criteria: `status: complete` in RETURN AND counts of `blockers` / `major` / `minor` are present.

### Writes

#### `review.md`

- Path: `.loom/<project>/review.md`.
- Must state pass, fail, or accepted risk.
- Must reference intent, design, plan, and build evidence.
- Must list blockers and major issues or state none.
- Must route unresolved work to an owner phase.
- Follows the Finding Shape declared in `phase.md` (Severity, Evidence, Expected, Actual, Impact, Recommendation, Owner phase).

#### `feedback.md`

- Path: `.loom/<project>/feedback.md`.
- Must capture user approval, requested change, rejection, or risk acceptance when asked.

#### `review-verdict.json`

- Path: `.loom/<project>/review-verdict.json`.
- Single-object JSON written atomically. Read by the evaluation harness as the canonical machine-readable verdict — `review.md` prose is for humans and is not parsed.

```json
{
  "verdict":  "PASS" | "FAIL",
  "blockers": <int>,
  "major":    <int>,
  "minor":    <int>,
  "note":     <int>
}
```

Counts are non-negative integers. `verdict` is `FAIL` whenever `blockers > 0`; otherwise `PASS`. Values must equal the counts in the RETURN block (`blockers`, `major`, `minor`) and the count of `## Note` findings in `review.md` (`note`).

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Cannot review due to missing input | Surface; offer rerun after fixing |
| `failed` | Review surfaced blockers that invalidate Build | Surface to user; user decides whether to rerun an earlier phase |
