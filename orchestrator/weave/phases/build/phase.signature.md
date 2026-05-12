# Build Coordinator Agent — Signature

I/O signature between `/weave` and the Build Coordinator Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == build` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `phase.md` and this signature (body first, then `\n\n---\n\n`, then signature).

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
| `principles.md` | `loom/principles.md` | yes | Engineering principles |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

### State preconditions

- `pipeline.md.Current phase` is `build`.
- Plan-phase artifacts exist; `board.md` has at least one task in `Backlog` or `In Progress`.

## Returns

### Return block

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity, completed, failed, hitl-pending]
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
```

Success criteria: `status: complete` in RETURN AND all tasks reached `Done` OR a clear blocker list is surfaced with `failed` / `hitl-pending` counts.

### Writes

#### Repository files

- Path: `<repo>/...`.
- Implementation per ready tasks. The Task Builder subagents own the writes; the Coordinator does not implement task scope itself.

#### `board.md`

- Path: `.loom/<project>/board.md`.
- Card transitions per the rules in `phase.md` › "## `board.md` Transition Rules".
- The four `## ` headers `Backlog`, `In Progress`, `Review`, `Done` still exist, in order.
- Every task that existed in the prior Plan `board.md` still exists in exactly one column (no cards lost).
- A task's column is consistent with its `done.md` status:
  - `status: green` → card in `Review` or `Done`.
  - `status: failed` → card in `In Progress` with the `[failed]` annotation.
  - `status: hitl-block` → card in `Backlog` with the `[HITL-blocked: ...]` annotation.
- No task is in `In Progress` without a `tasks/T-*.test-log.txt` recording at least one red attempt.
- No task is in `Done` without `smoke-report.md` evidence when the project is runnable.

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

#### `develop-log.md`

- Path: `.loom/<project>/develop-log.md`.
- Build observations, dual-written with `loom/orchestrator/log/build.md`.

#### `loom/orchestrator/log/build.md`

- Path: `loom/orchestrator/log/build.md`.
- Build-task log shard (dual-write with `develop-log.md`).

### State postconditions

- Every implemented task's card has transitioned correctly per the board rules.
- Per-task locks acquired and released (no orphaned `.locks/T-NNN.lock`).
- No commits / pushes / deploys / destructive commands have been run.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | Build cannot advance until input received | Surface; resume after input |
| `failed` | One or more tasks exhausted the three-attempt cap | Surface failed count; offer rerun (board is NOT reset) |

### Rerun rules

- Re-dispatch does not reset `board.md`. `In Progress` and `Done` cards stay where they are.
- The coordinator picks the next eligible `Backlog` cards.

## Methods available

- `methods/task.md` + `methods/task.signature.md` — Lock → Red → Implement → Green → Done loop per task. Three-attempt cap. Declares `phase: build-task` in its RETURN block (distinct from the Build Coordinator's `phase: build`) with status `green` / `failed` / `hitl-block`.
- `methods/smoke.md` + `methods/smoke.signature.md` — Runs when project is runnable. Produces `smoke-report.md`.
- `methods/mutation.md` + `methods/mutation.signature.md` — Runs only when `tests.md` enables mutation testing.
