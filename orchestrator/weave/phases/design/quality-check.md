# Design Quality Check Agent

Opt-in subagent that analyzes Design-phase artifacts and reports whether a rerun would meaningfully change the result.

## Reads

- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.

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

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
