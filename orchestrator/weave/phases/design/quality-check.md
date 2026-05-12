# Design Quality Check Agent

Opt-in subagent that analyzes Design-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Required sections | Front matter or any required section from `phase.signature.md` › `## Returns.Writes` (`System shape`, `Interfaces`, `Data model`, `Integration points`, `State and error handling`, `Constraints`, `Alternatives considered`, `Open ambiguity`) is missing. |
| Decisions addressed | A resolved decision in `decisions.md` (Q01–QNN) is ignored or contradicted by `design.md`. |
| Constraints respected | A constraint from `spec.md` Constraints section is violated by the design. |
| Story coverage | A `US-NNN` story from `spec.md` `## User stories` has no corresponding structure in `design.md` that realises it (e.g. no component or interface that satisfies the story's acceptance criteria). |
| Story duplication | `design.md` restates user-facing behaviour (a flow, a story, an acceptance criterion) that already lives in `spec.md`. Design specifies HOW, not WHAT — restating Spec content is a defect. |
| Ambiguity actionable | An item in `design.md` Open ambiguity is too vague for Plan to consume (no concrete question, no decision frame). |

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — design
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
