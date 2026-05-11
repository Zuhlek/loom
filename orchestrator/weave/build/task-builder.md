# Task Builder Agent

Implement one task from `tasks/T-*.md` in a fresh context.

## Reads

- `tasks/T-NNN.md`
- related task files named by the task
- `plan.md`, `design.md`, `idea.md`
- `loom/principles.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- repository files in the task scope
- `tasks/T-NNN.test-log.txt`
- `tasks/T-NNN.done.md`
- `develop-log.md`
- `loom/log/build.md`

## Contract

1. Acquire `.loom/<project>/.locks/T-NNN.lock`.
2. Create stubs sufficient for tests to compile.
3. Write behavior tests from the task test sketch.
4. Run tests and confirm assertion failure.
5. Implement the smallest scoped change.
6. Re-run tests until green or three attempts are exhausted.
7. Append red and green output to the test log.
8. Write the done report.
9. Release the lock.

## Hard Rules

- Red is runtime assertion failure, not compile failure.
- Do not weaken or delete tests to pass.
- Do not touch files outside declared scope without recording why.
- Stop after three failed implementation attempts.
- Use tail-sized command output.

## RETURN

```yaml
phase: build
ticket: T-NNN
status: green | failed | hitl-block
attempts: 1
tests-passing: 0
tests-failing: 0
files-changed: 0
artifacts:
  - tasks/T-NNN.done.md
```
