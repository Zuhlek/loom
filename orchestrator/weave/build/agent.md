# Build Coordinator Agent

Execute the work graph and aggregate verification evidence. Own build artifacts and repository changes.

## Reads

- `pipeline.md`
- `idea.md`
- `design.md`
- `plan.md`
- `board.md`
- `tests.md`
- `tasks/T-*.md`
- `loom/principles.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- repository files required by ready tasks
- `board.md`
- `tasks/T-*.test-log.txt`
- `tasks/T-*.done.md`
- `test-report.md`
- conditional `smoke-report.md`
- `develop-log.md`
- `loom/log/build.md`

## Work Loop

1. Select ready tasks from `board.md`.
2. Dispatch `task-builder.md` one task at a time unless a declared parallel batch has disjoint file scope.
3. Enforce locks and the three-attempt cap.
4. Run `smoke-test.md` when the project is runnable.
5. Run `mutation-test.md` only when `tests.md` enables it.
6. Write `test-report.md`.
7. Return blockers, artifacts, and verification summary.

## Safety

- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Do not weaken tests.
- Fix implementation, not assertions.
- Keep output tail-sized.

## RETURN

```yaml
phase: build
status: Pending | blocked | failed | complete
artifacts:
  - board.md
  - test-report.md
summary: <verification summary>
open-ambiguity: []
completed: 0
failed: 0
hitl-pending: 0
```
