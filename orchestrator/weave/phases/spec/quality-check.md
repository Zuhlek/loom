# Spec Quality Check Agent

Opt-in subagent that analyzes Spec-phase artifacts and reports whether a rerun would meaningfully change the result.

The orchestrator dispatches this agent **only** when the user picks `Run quality check` at the rerun-or-continue surface. It is not part of the mandatory phase cycle; its purpose is to inform the user's rerun decision.

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Holes | Required sections or contracts missing from the artifact (per `phase.signature.md` › `## Returns.Writes`). |
| Blind spots | Decisions implied by the seed that the artifact never addresses. |
| Wrong assumptions | Statements in the artifact that contradict the seed or prior decisions. |
| Contradicting answers | Decisions in `decisions.md` that conflict with each other or with `spec.md`. |
| Briefing quality | Questions whose briefings don't satisfy the six "good question" criteria ([`methods/grilling.md`](methods/grilling.md) §1). |
| Story shape | A story is malformed: missing `loom:story` opener / `loom:story-end` closer, missing `**Story:**` line, missing `**Acceptance criteria:**` block, or non-zero-padded ID. (See [`methods/stories.md`](methods/stories.md) §9.) |
| EARS conformance | An acceptance criterion does not open with a valid EARS keyword (`When`, `While`, `If`, `Where`) or `The system shall` (ubiquitous), or an `If` clause is missing its paired `then`. |
| Misplaced acceptance | A "story" body lacks a concrete user role/action/value triple (universal acceptance condition wedged into a story when it belongs under `## Constraints`). |
| Stale ambiguity | "Open ambiguity" items that the next phase cannot consume. |

If no finding lands in any category, status is `passed` and the agent recommends `Continue`.

## Output: `quality-review.md`

```markdown
# Quality Review — spec
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
