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

