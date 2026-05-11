# Build Validator

Opt-in subagent that analyzes Build-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

## Reads

- `pipeline.md` (Current phase + Phase status)
- The just-completed Build RETURN block (passed by the orchestrator)
- [`artifact.md`](artifact.md)
- `plan/tasks/T-*.md`, `plan/tasks/T-*.done.md`, `plan/tasks/T-*.test-log.txt` (read-only)
- `test-report.md`, `smoke-report.md` (read-only)
- `design.md`, `plan.md` for cross-reference

## Writes

- `quality-review.md` (workspace, overwritten on each Quality Check run)
- `pipeline.md` sections: `Quality findings`, `Pending user input`, `Next valid action`

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Task completion | A task is not `Done` and is not on a clear `failed` / `hitl-pending` list. |
| Test report aggregation | `test-report.md` is missing, or doesn't include per-task results. |
| Smoke report | `smoke-report.md` is missing when the project is runnable (per `design.md`). |
| Scope integrity | A task was weakened or deleted vs `plan/tasks/T-*.md` (cross-reference `T-*.done.md` and `T-*.test-log.txt` against the original task spec). |
| Safety | Any commit, push, or destructive command appears in task logs. |

The Build validator never re-executes tests, smokes, or mutations — every row above is a read-only cross-reference against the existing reports and logs.

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

## RETURN

```yaml
type: object
required: [phase, status, summary, recommendation, findings, artifacts]
properties:
  phase:
    enum: [quality-check]
  status:
    enum: [passed, findings]
  summary:
    type: string
  recommendation:
    enum: [continue, rerun]
  findings:
    type: array
    items:
      type: object
      required: [severity, title]
      properties:
        severity:
          enum: [blocker, major, minor, note]
        title:
          type: string
        suggested-focus:
          type: string
  artifacts:
    type: array
    items:
      type: string
```
