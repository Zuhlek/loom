# Ideate Log

## 2026-05-11 - loom-ui-phase-update - static-demo-drift-accepted-pattern

Q1=NO ("don't reauthor the static-demo's sample content; touch only
enough to compile") proved correct in practice: the static
`loom-view.tsx` route is a mockup-browser demo, not user-facing, so its
sample content's drift from the new lifecycle was an acceptable cost vs.
the churn of re-authoring `IdeaContent`, `PlanContent`, `KANBAN`,
`SAMPLE_BUILD_FILES`, etc. The pattern generalises: **when a file is in
a feature's scope but is demo/sample/mockup-only and not on a
user-facing path, prefer "compile-only fix" + accepted drift over
"reauthor the content."** The single leftover `"mockup/"` literal in
the `FILES` const is a clean expression of this: the test sketch even
warned about it, and Build correctly left it. Reusable cue: if the
narrowest fix exists, prefer it; widen scope only when narrowness ships
zero user value.

## 2026-05-11 - phase-validators - idea-subagent-asksuserquestion-relay

The Idea agent dispatched in a `Task` subagent surfaced six grilling
questions at once via `open-ambiguity` because `AskUserQuestion` was
not available in its tool set. The orchestrator picked the questions
up from the Idea agent's RETURN block and relayed them to the user via
its own `AskUserQuestion` from the orchestrator context.
`weave/SKILL.md` §"Direct Questions" documents this contract, and
`methods/grilling.md` prescribes "one question at a time", but the
practical pattern this run exposed is that a subagent without
`AskUserQuestion` permission has to surface all its branching
questions in a single return and let the orchestrator serialize them.
Worth capturing as a deliberate-not-accidental pattern: dispatching
grilling in a subagent is a feature (clean session boundary, smaller
context) at the cost of trading one-at-a-time grilling for
batched-then-relayed grilling. Reusable cue: if a phase agent is
permitted only to `Read` / `Write` / `Edit` (no `AskUserQuestion`),
grilling becomes "branch in one batch, relay through orchestrator."

