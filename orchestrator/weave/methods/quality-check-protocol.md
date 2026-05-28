# Quality Check Protocol

Shared shell for the lifecycle's single opt-in quality-check agent (Pre-Build QC at the Plan→Build gate). The `phases/plan/quality-check.md` file carries the agent body, the `## Checks` table covering Spec + Design + Plan layers, and a cross-reference back to this protocol.

There is no Spec, Design, or Build quality-check agent — issues that survive into Plan are caught here, at the last gate before repository changes land.

## Opener

Opt-in subagent that analyzes the full pre-Build artifact set (Spec + Design + Plan) and reports whether a rerun (or a go-back to an earlier phase) would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the Plan rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's decision before launching the irreversible Build phase.

The agent looks for evidence that proceeding to Build would either burn tokens on the wrong work or surface contradictions Build cannot resolve — see `phases/plan/quality-check.md` › `## Checks`.

If no finding lands in any category, status is `passed` and the agent recommends `Continue → start autonomous Build`.

## Output: `quality-review.md`

```markdown
# Pre-Build Quality Review
**Run at:** <iso-timestamp>
**Audited artifacts:** spec.md, decisions.md, design.md, plan.md, board.md, task.md, tests.md, tasks/T-*.md

## Summary
<one-paragraph verdict + rerun-worthiness signal>

## Findings

### <severity>: <one-line title>
- **Owner phase:** <spec | design | plan>
- **Evidence:** <file:section or quote>
- **Why it matters:** <one-line impact>
- **Suggested action:** <Continue | Rerun Plan | Go back to Design | Go back to Spec> — <what the action should address>

(repeat per finding)

## Recommendation
<Continue | Rerun Plan | Go back to Design | Go back to Spec> — <one-line reason>
```

The `Owner phase` field lets the user route the action to whichever phase the finding actually owns; the orchestrator's gate surfaces all four follow-up options after the QC returns.

## Severity vocabulary

Severities: `blocker`, `major`, `minor`, `note`. A `blocker` finding implies Build cannot consume the pre-Build artifacts without producing the wrong thing; `major` implies a likely Build regression or wasted task work; `minor` / `note` are polish.

## User-Facing Decision

The agent does NOT call `AskUserQuestion`. It writes `quality-review.md` and returns. The orchestrator surfaces the four-option rerun-or-continue decision (Continue / Rerun Plan / Go back to Design / Go back to Spec) using the findings preview (see `orchestrator/weave/SKILL.md`).
