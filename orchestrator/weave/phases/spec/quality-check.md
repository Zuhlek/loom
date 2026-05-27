# Spec Quality Check Agent

Opt-in subagent that analyzes Spec-phase artifacts and reports whether a rerun would meaningfully change the result.

## Reads

- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.
- `phases/spec/methods/grilling.md` — the six "good question" criteria the Briefing-quality check applies (§1).
- `phases/spec/methods/stories.md` — story-shape invariants the Story-shape check applies (§9).

## Checks

The agent looks for evidence that a rerun is worth the token burn:

| Check | What it surfaces |
| --- | --- |
| Holes | Required sections or contracts missing from the artifact (per `phase.signature.md` › `## Returns.Writes`). |
| Blind spots | Decisions implied by the seed that the artifact never addresses. |
| Wrong assumptions | Statements in the artifact that contradict the seed or prior decisions. |
| Contradicting answers | Decisions in `decisions.md` that conflict with each other or with `spec.md`. |
| Briefing quality | Questions whose briefings don't satisfy the six "good question" criteria ([`phases/spec/methods/grilling.md`](methods/grilling.md) §1). |
| Story shape | A story is malformed: missing `loom:story` opener / `loom:story-end` closer, missing `**Story:**` line, missing `**Acceptance criteria:**` block, or non-zero-padded ID. (See [`phases/spec/methods/stories.md`](methods/stories.md) §9.) |
| EARS conformance | An acceptance criterion does not open with a valid EARS keyword (`When`, `While`, `If`, `Where`) or `The system shall` (ubiquitous), or an `If` clause is missing its paired `then`. |
| Misplaced acceptance | A "story" body lacks a concrete user role/action/value triple (universal acceptance condition wedged into a story when it belongs under `## Constraints`). |
| Stale ambiguity | "Open ambiguity" items that the next phase cannot consume. |

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
