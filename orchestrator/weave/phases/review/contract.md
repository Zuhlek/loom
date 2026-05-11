# Review Contract

I/O contract between `/weave` and the Review Audit Agent.

## Invocation

**Caller:** `/weave` orchestrator
**Trigger:** `pipeline.md.Current phase == review` AND `Phase status ∈ {Pending, blocked, failed}`
**Dispatch:** Fresh `Task` session with [`agent.md`](agent.md) as system prompt

## Inputs

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| All phase artifacts | `.loom/<project>/{idea,design,plan,board,task,tests}.md` | yes | Read-only |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-NNN.done.md` | yes | Per-task done reports |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-NNN.test-log.txt` | yes | Per-task test logs |
| `test-report.md` | `.loom/<project>/test-report.md` | yes | Aggregated verification |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | conditional | When Build ran smoke-test |
| Repository diff | working tree | yes | Code under review |
| `principles.md` | `loom/principles.md` | yes | Engineering principles |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

## State preconditions

- `pipeline.md.Current phase` is `review`.
- Build-phase artifacts exist (`test-report.md` and per-task done reports).

## Outputs

| Artifact | Target path | Description |
| --- | --- | --- |
| `review.md` | `.loom/<project>/review.md` | Findings (severity, evidence, expected, actual, impact, recommendation, owner phase) |
| `feedback.md` | `.loom/<project>/feedback.md` | User-facing summary |
| `develop-log.md` | `.loom/<project>/develop-log.md` | Process learnings |
| Log appends | `loom/orchestrator/log/{audit,build,feedback,ideate}.md` | Routed by finding type |

## State postconditions

- `review.md` exists and follows the Finding Shape declared in [`agent.md`](agent.md).
- Appropriate log shards have been appended.
- RETURN block conforms to the schema in [`agent.md`](agent.md).

## Success criteria

- `status: complete` in RETURN.
- Counts of `blockers` / `major` / `minor` are present.

## Failure modes

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Cannot review due to missing input | Surface; offer rerun after fixing |
| `failed` | Review surfaced blockers that invalidate Build | Surface to user; user decides whether to rerun an earlier phase |

## Methods available

None.

## Validator

None — Review IS the project-level validator. Its findings are the output, not something to be re-checked.
