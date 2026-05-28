# Spec Quality Check Agent

Opt-in subagent that audits **only** the Spec-phase artifacts (`spec.md`, `decisions.md`) for within-phase quality and reports whether a Refine would meaningfully change the result. Narrower than the cross-phase Pre-Build Quality Check (at the Plan→Build gate); this agent does not look at downstream artifacts.

## Reads

- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.

## Checks

The agent looks for evidence that proceeding to Design with the current Spec artifacts would surface contradictions Design cannot resolve.

| Check | What it surfaces |
| --- | --- |
| Required sections | A `spec.md` missing one of the required sections (What we're building, Users and value, Scope, Out of scope, User stories, Constraints, Open ambiguity). |
| Story shape | A `## User stories` entry lacking the `loom:story` opening marker, the matching `loom:story-end` marker with the same `id`, or a `status` attribute on the opener. |
| Story content | A story without exactly one role/action/value `**Story:**` line, or with zero acceptance criteria, or with an acceptance criterion that does not open with a valid EARS keyword (`When`, `While`, `If`, `Where`) or `The system shall`. |
| Decision slot integrity | A `decisions.md` `<!-- loom:question -->` marker without a matching `<!-- loom:answer-slot -->` region with the same `id`; an active decision whose `Status:` value is not one of `awaiting-answer`, `answered`, `deferred`, `superseded-by Q<n'>`, `obsolete`, `active`. |
| Universal-acceptance anti-pattern | A `## User stories` entry that describes a universal envelope condition (no concrete user action) — those belong under `## Constraints`. |
| Open ambiguity surfacing | A `## Open ambiguity` item that contradicts a `Status: answered` decision (signals revisit was skipped). |

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
