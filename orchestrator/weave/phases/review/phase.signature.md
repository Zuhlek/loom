# Review Audit Agent — Signature

I/O signature between `/weave` and the Review Audit Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == review` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `phase.md` and this signature (body first, then `\n\n---\n\n`, then signature). Review has no quality-check agent — Review IS the project-level quality check.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| All phase artifacts | `.loom/<project>/{spec,design,plan,board,task,tests}.md` | yes | Read-only |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-NNN.done.md` | yes | Per-task done reports |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-NNN.test-log.txt` | yes | Per-task test logs |
| `test-report.md` | `.loom/<project>/test-report.md` | yes | Aggregated verification |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | conditional | When Build ran smoke-test |
| Repository diff | working tree | yes | Code under review |
| `principles.md` | `loom/principles.md` | yes | Engineering principles |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

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

#### `develop-log.md`

- Path: `.loom/<project>/develop-log.md`.
- Must record process observations worth later curation.
- Learning entries must use the heading `## YYYY-MM-DD - <project> - <topic>`.

#### Global learning-shard appends (dual-write)

Review writes learning observations to two surfaces. Both are required.

| Stream | Path | Purpose |
| --- | --- | --- |
| Project-local | `.loom/<project>/develop-log.md` | Raw observations for this project |
| Global shard | `loom/orchestrator/log/{audit,build,feedback,ideate}.md` | Curation source for `/tune review` |

For every learning observation written to `develop-log.md`, a matching `## YYYY-MM-DD - <project> - <topic>` entry must exist in the appropriate `loom/orchestrator/log/<shard>.md`:

| Topic | Shard |
| --- | --- |
| Spec / Design / Plan process notes | `ideate.md` |
| Build / Smoke / Mutation process notes | `build.md` |
| Cross-phase audit observations | `audit.md` |
| User-pushback or feedback patterns the user surfaced | `feedback.md` |

If the user opts into a Quality Check on Review, the check verifies that every project-local learning entry has a matching global-shard entry. A missing append is a `major` finding.

Review-cycle findings (the `review.md` content itself) stay project-local — they are not duplicated to the global shards.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Cannot review due to missing input | Surface; offer rerun after fixing |
| `failed` | Review surfaced blockers that invalidate Build | Surface to user; user decides whether to rerun an earlier phase |
