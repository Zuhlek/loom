# Build Task-Builder Agent — Signature

I/O signature between the Build Coordinator and a Task Builder subagent.

## Trigger

**Caller:** Build Coordinator (the `phase.md` body of `phases/build/`).

**Invocation condition:** Coordinator picks a ready task from `board.md` (Backlog → In Progress transition) and dispatches a fresh `Task` subagent. The system prompt is the concatenation of `task.md` and this signature (body first, then `\n\n---\n\n`, then signature).

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `tasks/T-NNN.md` | `.loom/<project>/tasks/T-NNN.md` | yes | Task spec (frontmatter + body) — the single task being implemented |
| Related task files | `.loom/<project>/tasks/...` | when named by the task | Additional files the task references |
| `plan.md` | `.loom/<project>/plan.md` | yes | Work graph + verification environment |
| `design.md` | `.loom/<project>/design.md` | yes | Solution structure context |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent context |
| `principles.md` | `loom/principles.md` | yes | Engineering principles |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

## Returns

`phase: build-task` (NOT `build`) — the Build Coordinator and the task-builder share the same lifecycle phase tag historically but use distinct return phase tags so the orchestrator and hook can distinguish them.

### Return block

```yaml
type: object
required: [phase, ticket, status, attempts, artifacts]
properties:
  phase:
    enum: [build-task]
  ticket:
    pattern: ^T-[0-9]{3}$
  status:
    enum: [green, failed, hitl-block]
  attempts:
    type: integer
    minimum: 1
    maximum: 3
  tests-passing:
    type: integer
  tests-failing:
    type: integer
  files-changed:
    type: integer
  artifacts:
    type: array
    items:
      type: string
```

### Writes

#### Repository files in task scope

- Path: `<repo>/...`.
- The implementation files needed to satisfy the task's acceptance criteria. Smallest scoped diff per `principles.md` P1.

#### `tasks/T-NNN.test-log.txt`

- Path: `.loom/<project>/tasks/T-NNN.test-log.txt`.
- Contains BOTH the red output (runtime assertion failure, not compile error) and the green output (after implementation passes).
- Tail-sized — verbose test runners are piped through `tail -100`.

#### `tasks/T-NNN.done.md`

- Path: `.loom/<project>/tasks/T-NNN.done.md`.
- Front matter:

  ```yaml
  task: T-NNN
  status: green | failed | hitl-block
  attempts: 1
  duration-seconds: 0
  files-changed: []
  out-of-scope-edits: []     # path + one-line reason per edit
  notes: <optional one-paragraph remarks>
  ```

#### `develop-log.md`

- Path: `.loom/<project>/develop-log.md`.
- Build-task entry, dual-written with `loom/orchestrator/log/build.md`.

#### `loom/orchestrator/log/build.md`

- Path: `loom/orchestrator/log/build.md`.
- Matching build-task entry for the global log shard.

## Throws

| Return status | Meaning | Coordinator action |
| --- | --- | --- |
| `green` | All tests in the task scope pass; done report written | Transition card from `In Progress` to `Review` |
| `failed` | Three implementation attempts exhausted | Keep card in `In Progress` with `[failed]` annotation; next dispatch can pick up |
| `hitl-block` | Test contract itself is wrong (contradiction with spec/design) — do not silently edit | Move card to `Backlog` with `[HITL-blocked: <reason>]` annotation |
