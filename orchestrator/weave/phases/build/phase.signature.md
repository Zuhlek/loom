# Build Phase Agent — Signature

I/O signature between `/weave` and the Build Phase Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == build` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`; resolve `<project>` / `<phase>` / `<task>` placeholders by reading the `<system-reminder>` tail block.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent |
| `design.md` | `.loom/<project>/design.md` | yes | Solution structure |
| `plan.md` | `.loom/<project>/plan.md` | yes | Work graph narrative (including the `Verification environment` declaration consumed by the pre-flight in step 0) |
| `board.md` | `.loom/<project>/board.md` | yes | Kanban (task readiness) |
| `tests.md` | `.loom/<project>/tests.md` | yes | Test strategy + mutation-test opt-in |
| `tasks/T-*.md` | `.loom/<project>/tasks/T-NNN.md` | yes | Per-task definitions |
| `principles.md` | `methods/principles.md` (inlined into dispatch head) | yes | Engineering principles |
| `type-guidance.md` | `.loom/<project>/type-guidance.md` | when typed | Domain guidance (materialized at project creation from the active `types/<type>.md`) |

### State preconditions

- `pipeline.md.Current phase` is `build`.
- Plan-phase artifacts exist; `board.md` has at least one task in `Backlog` or `In Progress`.

## Returns

### Return block

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity, completed, failed, hitl-pending, task-outcomes, smoke]
properties:
  phase:
    enum: [build]
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
  completed:
    type: integer
  failed:
    type: integer
  hitl-pending:
    type: integer
  task-outcomes:                  # required, can be empty array (means Build did no work this session)
    type: array
    items:
      type: object
      required: [id, status]
      properties:
        id: {type: string}        # T-NNN format
        status: {enum: [green, failed, hitl-block]}
        attempts: {type: integer}
        hitl-reason: {type: string}   # required when status: hitl-block
  smoke:                          # required: present even when Build didn't run smoke (ran: false)
    type: object
    required: [ran]
    properties:
      ran: {type: boolean}
      passed: {type: boolean}     # required when ran=true
```

Success criteria: `status: complete` in RETURN AND all tasks reached `Done` OR a clear blocker list is surfaced with `failed` / `hitl-pending` counts.

### Writes

#### Repository files

- Path: `<repo>/...`.
- Implementation per ready tasks. The Build agent owns all repository writes within this session.

#### `tasks/T-*.test-log.txt`

- Path: `.loom/<project>/tasks/T-NNN.test-log.txt`.
- Red + green output per task. Red phase failure is an assertion failure, not a compile error. Green phase output is present.

#### `tasks/T-*.done.md`

- Path: `.loom/<project>/tasks/T-NNN.done.md`.
- Every completed, failed, or HITL-blocked task has a done report with the front matter:

  ```yaml
  task: T-NNN
  status: green | failed | hitl-block
  attempts: 1
  duration-seconds: 0
  files-changed: []
  out-of-scope-edits: []
  ```

- Failed tasks stop at three attempts.

#### `test-report.md`

- Path: `.loom/<project>/test-report.md`.
- Aggregated verification — summarizes task, smoke, and mutation evidence.

#### `smoke-report.md` (conditional)

- Path: `.loom/<project>/smoke-report.md`.
- Produced when the project is runnable; required for any task to transition to `Done` in that case.

### State postconditions

- Every implemented task is represented in the RETURN block's `task-outcomes` array with a terminal status (`green` | `failed` | `hitl-block`). The orchestrator translates these into board transitions per `SKILL.md § Board transition mapping`.
- No commits / pushes / deploys / destructive commands have been run.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Build cannot advance until input received | Surface; resume after input |
| `failed` | One or more tasks exhausted the three-attempt cap | Surface failed count; offer rerun (board is NOT reset) |

### Rerun rules

- Re-dispatch does not reset `board.md`. `In Progress` and `Done` cards stay where they are.
- A new Build session picks the next eligible `Backlog` cards.

## Procedures applied within this session

These procedure files arrive inlined in the dispatch prompt (per the body's `## Reads`, see `orchestrator/weave/SKILL.md § Dispatch concatenation`); the Build agent applies them from the inlined head at the relevant steps of its work loop — no disk read. They are not dispatched as subagents — they execute inline within the Build session.

- `methods/task.md` — Lock → Red → Implement → Green → Done loop, applied per ready task. Three-attempt cap.
- `methods/smoke.md` — Runnable verification, applied once after the per-task loop completes when the project is runnable. Produces `smoke-report.md`.
- `methods/mutation.md` — Per-task test-strength probe, applied after a task reaches green when `tests.md` enables mutation testing.
