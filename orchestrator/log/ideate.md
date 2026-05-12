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


## 2026-05-12 - chat-ui-parity - heavy-spec-handin-light-plan-handin

(Mirror of the feedback.md entry — included here because Spec is the
ideation surface and the pattern speaks to where ideation effort
pays back.)

User invested heavily on Spec (4 touches: initial Q-batch + 2 reruns
+ 2 QC passes) and accepted Design + Plan with no rerun (1 touch
each at the gate). Live smoke landed 7/7 on the first walk. Reads as:
heavy upstream-ideation polish correlates with low downstream rework.
Spec is the most expensive-to-iterate-late artifact in this funnel;
the user's instinct to insist on prose-level polish before advancing
proved correct (downstream rework was zero), even though the Spec
agent's recommendations on rerun-vs-continue were "continue" both
times. Reusable cue for `/tune ideate`: when the project is "single
turn feels right" / UX polish flavoured, treat Spec rerun depth as a
leading indicator of Build/Review friction. Validators that lean
"continue" on prose-quality findings may miss UX-polish projects'
need for higher Spec hygiene than functional projects need.

## 2026-05-12 - weave-phase-folder-restructure - spec auto-resolved decisions without grilling

Spec produced 7 stories and 8 branching decisions (Q01..Q08) without
surfacing any direct grilling questions to the user. Seed plus the
pre-flight repo-context were rich enough that Spec resolved all 8
decisions internally — Q01..Q03 from the seed wording itself, Q04..Q08
from repo pre-flight risk surfacing — and wrote them to `decisions.md`
for the user to override post-hoc rather than answer pre-hoc. The
user's only pre-Spec input was the predecessor-undo note. The
"1-question-at-a-time grilling" canonical pattern in
`methods/grilling.md` doesn't apply uniformly: when the inputs already
foreclose the decision space, Spec can default-resolve and surface
only the slot for review. This is a feature, not a regression — lower
friction, faster spec, and `decisions.md` remains both the audit trail
and the override surface. Reusable cue for `/tune ideate`: a rich-enough
seed + pre-flight repo-context can collapse grilling to zero questions;
if `decisions.md` is well-populated with rationale + alternatives + the
"override the slot to flip" instruction, the user retains full control
without paying the round-trip cost of N grilling questions.

## 2026-05-12 - weave-phase-folder-restructure - plan opt-in quality check carries signal even with zero findings

User opted into Plan QC after Plan completed. QC ran cheaply and
returned `recommendation: continue` with zero findings (graph integrity,
story coverage, frontmatter completeness, HITL-cleanness, verification
soundness all passed). The value was not in finding issues — none
existed — but in providing explicit confidence to enter autonomous
Build without a "did I miss something?" doubt. For a project where the
next phase is autonomous and irreversible (Build mutates the repo,
HITL-absorbed-into-Plan per project memory), the QC's role is to
confirm the green light, not to discover problems. Reusable cue:
opt-in QC on AFK-gated transitions has high signal even when it finds
nothing — the binary "passed" output is itself the deliverable. Worth
recommending QC by default at any AFK-gate transition (Plan → Build),
not only on high-uncertainty plans.
