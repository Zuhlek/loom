# Build Quality Check Agent

Opt-in subagent that analyzes Build-phase artifacts and reports whether a rerun would meaningfully change the result.

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Task completion | A task is not `Done` and is not on a clear `failed` / `hitl-pending` list. |
| Test report aggregation | `test-report.md` is missing, or doesn't include per-task results. |
| Smoke report | `smoke-report.md` is missing when the project is runnable (per `design.md`). |
| Scope integrity | A task was weakened or deleted vs `plan/tasks/T-*.md` (cross-reference `T-*.done.md` and `T-*.test-log.txt` against the original task spec). |
| Safety | Any commit, push, or destructive command appears in task logs. |

The Build quality-check agent never re-executes tests, smokes, or mutations — every row above is a read-only cross-reference against the existing reports and logs.

See `weave/methods/quality-check-protocol.md` for output format, severity definitions, and the no-AskUserQuestion rule.
