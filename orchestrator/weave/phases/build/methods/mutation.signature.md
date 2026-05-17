# Build Mutation-Test Agent — Signature

I/O signature between the Build Coordinator and the Mutation-Test subagent.

## Trigger

**Caller:** Build Coordinator (the `phase.md` body of `phases/build/`).

**Invocation condition:** `tests.md` declares `**Mutation Testing:** yes` at the top of the file AND a task has completed its green phase. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`; resolve `<project>` / `<phase>` / `<task>` placeholders by reading the `<system-reminder>` tail block. One task per session.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `tests.md` | `.loom/<project>/tests.md` | yes | Mutation-testing opt-in declaration + strategy |
| `tasks/T-NNN.md` | `.loom/<project>/tasks/T-NNN.md` | yes | The single task being probed |
| Task diff | working tree | yes | Changes the task introduced |
| Task test log | `.loom/<project>/tasks/T-NNN.test-log.txt` | yes | Existing red+green output for context |

## Returns

### Return block

```yaml
type: object
required: [phase, ticket, status]
properties:
  phase:
    enum: [mutate]
  ticket:
    pattern: ^T-[0-9]{3}$
  status:
    enum: [complete, failed, skipped]
  mutants-created:
    type: integer
  killed-existing:
    type: integer
  killed-new-test:
    type: integer
  unkillable:
    type: integer
  reason:
    type: string
```

### Writes

#### `tasks/T-NNN.test-log.txt` (appended)

- Path: `.loom/<project>/tasks/T-NNN.test-log.txt`.
- Mutation section appended to the existing red+green log: one entry per mutant (KILLED / SURVIVED / SURVIVED->KILLED / UNKILLABLE).

#### Optional new tests

- Path: `<repo>/...` (test files).
- New behaviour tests that kill surviving mutants. Existing tests must NOT be modified during this phase; gaps are filled with additional tests only.

#### `develop-log.md`

- Path: `.loom/<project>/develop-log.md`.
- Mutation observations, dual-written with `orchestrator/log/build.md`.

#### `orchestrator/log/build.md`

- Path: `orchestrator/log/build.md`.
- Matching mutation entry for the global log shard.

## Throws

| Return status | Meaning | Coordinator action |
| --- | --- | --- |
| `complete` | Mutation pass finished; all real survivors have new tests | Continue with smoke / done-transition |
| `failed` | State restore conflict (implementation could not be restored after a mutation) | Surface failure; the affected task stays in `Review` |
| `skipped` | `tests.md` does not enable mutation testing | No mutation pass run; tasks proceed without mutation evidence |
