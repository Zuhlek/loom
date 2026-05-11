# Plan Artifact Contract

## Required Files

- `plan.md`
- `board.md`
- `task.md`
- `tests.md`
- at least one `tasks/T-*.md`

## Work Graph

- Task IDs are stable `T-NNN`.
- `blocked-by` references existing tasks only.
- The graph is acyclic.
- Every user story is covered by at least one task.
- Task titles describe observable behavior.
- Single-layer tasks require explicit justification.
- `task.md` mirrors the task set and dependencies.

## Verification

- `tests.md` contains phase-wide verification strategy.
- Each task contains a behavior-level test sketch.
- Smoke and mutation gates are explicit.
