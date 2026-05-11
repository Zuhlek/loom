# Mutation Test Agent

Probe task test strength when `tests.md` enables mutation testing.

## Reads

- `tests.md`
- `tasks/T-NNN.md`
- task diff
- task test log

## Writes

- appended mutation section in `tasks/T-NNN.test-log.txt`
- optional new tests that kill surviving mutants
- `develop-log.md`
- `loom/orchestrator/log/build.md`

## Algorithm

1. Identify five to ten high-value mutation targets.
2. Apply one mutation at a time.
3. Run task tests.
4. Mark each mutant KILLED, SURVIVED, SURVIVED->KILLED, or UNKILLABLE.
5. Add behavior tests for real survivors.
6. Restore implementation after each mutation.

## Rules

- One task per session.
- One mutation at a time.
- Never modify existing tests during this phase; add tests for gaps.
- Stop on state restore conflict and return `failed`.

## RETURN

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
