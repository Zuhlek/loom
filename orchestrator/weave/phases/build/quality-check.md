# Build Quality Check Agent

Opt-in subagent that analyzes Build-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

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

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — build
**Run at:** <iso-timestamp>
**Phase artifacts:** <artifact list>

## Summary
<one-paragraph verdict + rerun-worthiness signal>

## Findings

### <severity>: <one-line title>
- **Evidence:** <file:section or quote>
- **Why it matters:** <one-line impact>
- **Suggested rerun focus:** <what the rerun should refine>

(repeat per finding)

## Recommendation
<Continue | Rerun phase> — <one-line reason>
```

Severities: `blocker`, `major`, `minor`, `note`. A `blocker` finding implies the next phase cannot consume the output; major implies a likely regression; minor / note are polish.

## User-Facing Decision

The agent does NOT call `AskUserQuestion`. It writes `quality-review.md` and returns. The orchestrator surfaces the rerun-or-continue decision using the findings preview (see `weave/SKILL.md`).
