# Idea Validator

Opt-in subagent that analyzes Idea-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

## Reads

- `pipeline.md` (Current phase + Phase status)
- The just-completed Idea RETURN block (passed by the orchestrator)
- [`artifact.md`](artifact.md)
- `idea.md`, `decisions.md` (read-only)
- `seed.md` (to compare intent against the produced `idea.md`)

## Writes

- `quality-review.md` (workspace, overwritten on each Quality Check run)
- `pipeline.md` sections: `Quality findings`, `Pending user input`, `Next valid action`

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Holes | Required sections or contracts missing from the artifact (per [`artifact.md`](artifact.md)). |
| Blind spots | Decisions implied by the seed that the artifact never addresses. |
| Wrong assumptions | Statements in the artifact that contradict the seed or prior decisions. |
| Contradicting answers | Decisions in `decisions.md` that conflict with each other or with `idea.md`. |
| Briefing quality | Questions whose briefings don't satisfy the six "good question" criteria ([`methods/grilling.md`](methods/grilling.md) §1). |
| Stale ambiguity | "Open ambiguity" items that the next phase cannot consume. |

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — idea
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
