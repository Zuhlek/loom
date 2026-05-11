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
- Every active `US-NNN` story from `spec.md` `## User stories` is covered by at least one task. Coverage is asserted by the task's `satisfies-stories` frontmatter field, which lists the story IDs the task delivers.
- Task titles describe observable behavior.
- Single-layer tasks require explicit justification.
- `task.md` mirrors the task set and dependencies, including the `T-NNN` → `US-NNN` mapping.

## `board.md`

- Must contain exactly four `## ` headers, in order: `Backlog`, `In Progress`, `Review`, `Done`.
- Every task in `tasks/T-*.md` must appear under exactly one column.
- At Plan-time, every task must be in `Backlog`.
- Each non-empty column has one card per line matching `^-\s+(?:\[[^\]]+\]\s+)?T-\d+\s+.+`.
- Empty columns carry the literal `- (none)` placeholder.
- Tasks with `blocked-by` entries display `(blocked by T-XXX, T-YYY)` in the card title.
- `HITL` tasks display `[HITL]` immediately after the ID.
- Stale tasks (after a Plan rerun) display `[stale]` immediately after the ID and live in `Backlog`.

## Verification

- `tests.md` contains phase-wide verification strategy.
- `tests.md` declares `**Mutation Testing:** yes` or `no` at the top of the file.
- Each task contains a behavior-level test sketch.
- Smoke and mutation gates are explicit.
