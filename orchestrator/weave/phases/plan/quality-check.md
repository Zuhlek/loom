# Plan Quality Check Agent

Opt-in subagent that analyzes Plan-phase artifacts and reports whether a rerun would meaningfully change the result.

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Graph integrity | A cycle in `blocked-by` edges; a `blocked-by` referencing a task that doesn't exist. |
| Story coverage | An active `US-NNN` story from `spec.md` `## User stories` has zero tasks with that ID in their `satisfies-stories` field. |
| Slice quality | A task that slices horizontally (e.g. "all DB migrations") instead of vertically (a thin end-to-end slice of one or more stories). |
| Frontmatter | A `tasks/T-NNN.md` missing required frontmatter fields per `phase.signature.md` › `## Returns.Writes`, including `satisfies-stories`. |
| HITL surfacing | A decision the autonomous-Build commitment would normally interrupt on is not represented as a variant in Plan. |
| Test coverage | A task lists `US-NNN` in `satisfies-stories` but its test sketch doesn't address the story's EARS acceptance criteria. |

See `weave/methods/quality-check-protocol.md` for output format, severity definitions, and the no-AskUserQuestion rule.
