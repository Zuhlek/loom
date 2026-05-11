# Build Contract

I/O contract between `/weave` and the Build Coordinator Agent.

## Invocation

**Caller:** `/weave` orchestrator
**Trigger:** `pipeline.md.Current phase == build` AND `Phase status ∈ {Pending, blocked, failed}`
**Dispatch:** Fresh `Task` session with [`agent.md`](agent.md) as system prompt

## Inputs

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/idea.md` | yes | Specified intent |
| `design.md` | `.loom/<project>/design.md` | yes | Solution structure |
| `plan.md` | `.loom/<project>/plan.md` | yes | Work graph narrative |
| `board.md` | `.loom/<project>/board.md` | yes | Kanban (task readiness) |
| `tests.md` | `.loom/<project>/tests.md` | yes | Test strategy + mutation-test opt-in |
| `tasks/T-*.md` | `.loom/<project>/tasks/T-NNN.md` | yes | Per-task definitions |
| `principles.md` | `loom/principles.md` | yes | Engineering principles |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

## State preconditions

- `pipeline.md.Current phase` is `build`.
- Plan-phase artifacts exist; `board.md` has at least one task in `Backlog` or `In Progress`.

## Outputs

| Artifact | Target path | Description |
| --- | --- | --- |
| Repository files | `<repo>/...` | Implementation per ready tasks |
| `board.md` | `.loom/<project>/board.md` | Card transitions per the rules in [`agent.md`](agent.md) |
| `tasks/T-*.test-log.txt` | `.loom/<project>/tasks/T-NNN.test-log.txt` | Red+green output per task |
| `tasks/T-*.done.md` | `.loom/<project>/tasks/T-NNN.done.md` | Per-task done report |
| `test-report.md` | `.loom/<project>/test-report.md` | Aggregated verification |
| `smoke-report.md` | `.loom/<project>/smoke-report.md` | Conditional — when project runnable |
| `develop-log.md` | `.loom/<project>/develop-log.md` | Build observations (dual-write with `loom/orchestrator/log/build.md`) |
| `loom/orchestrator/log/build.md` | `loom/orchestrator/log/build.md` | Build-task log shard |

## State postconditions

- Every implemented task's card has transitioned correctly per the board rules in [`agent.md`](agent.md).
- Per-task locks acquired and released (no orphaned `.locks/T-NNN.lock`).
- RETURN block conforms to the schema in [`agent.md`](agent.md).
- No commits / pushes / deploys / destructive commands have been run.

## Success criteria

- `status: complete` in RETURN.
- All tasks reached `Done` OR a clear blocker list is surfaced with `failed` / `hitl-pending` counts.

## Failure modes

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Build cannot advance until input received | Surface; resume after input |
| `failed` | One or more tasks exhausted the three-attempt cap | Surface failed count; offer rerun (board is NOT reset) |

### Build rerun rules

- Re-dispatch does not reset `board.md`. `In Progress` and `Done` cards stay where they are.
- The coordinator picks the next eligible `Backlog` cards.

## Methods available

- [`methods/task-builder.md`](methods/task-builder.md) — Lock → Red → Implement → Green → Done loop per task. Three-attempt cap. Returns `green` / `failed` / `hitl-block`.
- [`methods/smoke-test.md`](methods/smoke-test.md) — Runs when project is runnable. Produces `smoke-report.md`.
- [`methods/mutation-test.md`](methods/mutation-test.md) — Runs only when `tests.md` enables mutation testing.

## Validator

None — validation is integrated via `methods/smoke-test.md` and `methods/mutation-test.md` per the work loop in [`agent.md`](agent.md).
