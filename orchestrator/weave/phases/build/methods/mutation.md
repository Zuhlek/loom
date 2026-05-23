# Mutation procedure — task test-strength probe

Inline procedure the Build phase agent applies per task after the task reaches green, only when `tests.md` declares `**Mutation Testing:** yes` at the top of the file. Not dispatched as a subagent.

## Algorithm

For task `T-NNN`:

1. Identify five to ten high-value mutation targets in the files the task changed.
2. Apply one mutation at a time.
3. Run the task's tests against the mutated implementation.
4. Mark each mutant `KILLED`, `SURVIVED`, `SURVIVED->KILLED`, or `UNKILLABLE`.
5. Add behavior tests for real survivors (`SURVIVED`); do not modify existing tests.
6. Restore the implementation after each mutation. On state-restore conflict, stop and record `status: failed` for this task's mutation pass.

## Rules

- One mutation at a time.
- Never modify existing tests during this procedure; add tests for gaps.
- Stop on state-restore conflict and surface the conflict in the task's test log.

## Outcome

| Outcome | Build agent action |
| --- | --- |
| Mutation pass finished, every real survivor has a new test | Continue to the next task; smoke runs after the per-task loop completes |
| State-restore conflict (implementation could not be restored after a mutation) | Surface the failure in the test log; affected task stays in `Review` until the conflict is resolved |
| `tests.md` does not enable mutation testing | Procedure is not applied; task proceeds without mutation evidence |

## Writes

| Path | Notes |
| --- | --- |
| `.loom/<project>/tasks/T-NNN.test-log.txt` | Mutation section appended to the existing red+green log: one entry per mutant (`KILLED` / `SURVIVED` / `SURVIVED->KILLED` / `UNKILLABLE`). |
| `<repo>/...` (test files) | New behaviour tests that kill surviving mutants. Existing tests must NOT be modified during this procedure. |
| `~/.claude/skills/develop-log.md` | One `## [YYYY-MM-DD] — <project> — Phase: build` entry summarising the mutation pass, with `**Skill:** weave`. |
