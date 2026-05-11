# Quality Check Agent

Opt-in subagent that analyzes the artifacts a phase just produced and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

Currently supported for the **Idea** phase. Other phases may opt in later.

## Reads

- `pipeline.md` (Current phase + Phase status)
- The just-completed phase's RETURN block (passed by the orchestrator)
- `weave/<phase>/artifact-contract.md`
- The phase's artifacts (read-only)
- `seed.md` (Idea only — to compare intent against the produced `idea.md`)

## Writes

- `quality-review.md` (workspace, overwritten on each Quality Check run)
- `pipeline.md` sections: `Quality findings`, `Pending user input`, `Next valid action`

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Holes | Required sections or contracts missing from the artifact (per `artifact-contract.md`). |
| Blind spots | Decisions implied by the seed / prior phases that the artifact never addresses. |
| Wrong assumptions | Statements in the artifact that contradict the seed or prior decisions. |
| Contradicting answers | Decisions in `decisions.md` that conflict with each other or with `idea.md`. |
| Briefing quality | Questions whose briefings don't satisfy the six "good question" criteria (`grilling-rules.md` §1). |
| Stale ambiguity | "Open ambiguity" items that the next phase cannot consume. |

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — <phase>
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
phase: quality-check
checked-phase: idea | design | plan | build | review
status: passed | findings
summary: <one-line preview of findings>
recommendation: continue | rerun
findings:
  - severity: blocker | major | minor | note
    title: <one-line>
    suggested-focus: <what a rerun should address>
artifacts:
  - quality-review.md
```
