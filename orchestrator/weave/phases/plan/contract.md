# Plan Contract

I/O contract between `/weave` and the Work Graph Agent.

## Invocation

**Caller:** `/weave` orchestrator
**Trigger:** `pipeline.md.Current phase == plan` AND `Phase status ∈ {Pending, blocked, failed}`
**Dispatch:** Fresh `Task` session with [`agent.md`](agent.md) as system prompt

## Inputs

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Spec-phase decisions |
| `design.md` | `.loom/<project>/design.md` | yes | Solution structure |
| Evidence artifacts | `.loom/<project>/mockup/` etc. | optional | Design-phase evidence |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

## State preconditions

- `pipeline.md.Current phase` is `plan`.
- Spec and Design phase artifacts exist.

## Outputs

| Artifact | Target path | Description |
| --- | --- | --- |
| `plan.md` | `.loom/<project>/plan.md` | Work graph narrative — required sections per [`artifact.md`](artifact.md) |
| `board.md` | `.loom/<project>/board.md` | Kanban with four columns: Backlog, In Progress, Review, Done |
| `task.md` | `.loom/<project>/task.md` | Task index |
| `tests.md` | `.loom/<project>/tests.md` | Test strategy (incl. mutation-test opt-in) |
| `tasks/T-*.md` | `.loom/<project>/tasks/T-NNN.md` | Per-task files with required frontmatter |
| `ticket.md` | `.loom/<project>/ticket.md` | Optional |

## State postconditions

- `board.md` has every Plan-created task under `Backlog` (rules in [`agent.md`](agent.md) §"Rules at Plan-time").
- Every `tasks/T-*.md` carries the required frontmatter fields (id, title, type, status, blocked-by, covers, touches-layers, files-likely-touched).
- DAG validates: no missing dependencies, no cycles.
- RETURN block conforms to the schema in [`agent.md`](agent.md).

## Success criteria

- `status: complete` in RETURN.
- Build coordinator can pick ready tasks from `board.md` without ambiguity.

## Failure modes

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated for plan-critical ambiguity | Surface the question; write answer back on next dispatch |
| `failed` | Graph coverage validation failed | Surface to user; offer rerun |

### Plan rerun rules

- Existing `T-NNN` IDs are preserved across reruns.
- Tasks in `In Progress`, `Review`, `Done` stay in column unless explicitly invalidated.
- Invalidated tasks return to `Backlog` with a `[stale]` tag.

## Methods available

None.

## Validator

None in this phase.
