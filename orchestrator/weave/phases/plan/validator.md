# Plan Validator

Opt-in subagent that analyzes Plan-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

## Reads

- `pipeline.md` (Current phase + Phase status)
- The just-completed Plan RETURN block (passed by the orchestrator)
- [`artifact.md`](artifact.md)
- `design.md`, `spec.md`, `decisions.md` (read-only)
- `plan.md`, `plan/board.md`, `plan/task.md`, `plan/tests.md`, `plan/tasks/T-*.md` (read-only)

## Writes

- `quality-review.md` (workspace, overwritten on each Quality Check run)
- `pipeline.md` sections: `Quality findings`, `Pending user input`, `Next valid action`

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Graph integrity | A cycle in `blocked-by` edges; a `blocked-by` referencing a task that doesn't exist. |
| Story coverage | An active `US-NNN` story from `spec.md` `## User stories` has zero tasks with that ID in their `satisfies-stories` field. |
| Slice quality | A task that slices horizontally (e.g. "all DB migrations") instead of vertically (a thin end-to-end slice of one or more stories). |
| Frontmatter | A `tasks/T-NNN.md` missing required frontmatter fields per [`artifact.md`](artifact.md), including `satisfies-stories`. |
| HITL surfacing | A decision the autonomous-Build commitment would normally interrupt on is not represented as a variant in Plan. |
| Test coverage | A task lists `US-NNN` in `satisfies-stories` but its test sketch doesn't address the story's EARS acceptance criteria. |

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — plan
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
