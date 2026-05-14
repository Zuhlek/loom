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

## 2026-05-12 - chat-streaming-fixes - follow-up-loom velocity vs greenfield-loom velocity

chat-streaming-fixes ran Spec → Design → Plan → Build → Review in
~2 hours wall-clock. The parent chat-ui-parity loom ran the same
lifecycle in ~8 hours. The ~4× collapse is attributable to inherited
anchors that the follow-up loom did NOT re-litigate:

- Spec inherited parent Q01 (single-turn-feel parity bar) and Q02
  (internal-team daily-driver UX bar) as foundational anchors. Same
  with Constraints (SDK pin, wire-mirror discipline, bundle budget,
  `dangerouslySetInnerHTML` trust boundary, typed-broadcast
  boundary). The decisions.md "Inheritance note" section explicitly
  enumerates which parent anchors apply.
- Design inherited the entire system shape from `repo-context.md` —
  the diff surfaces were already known from the parent's work. ADR
  scope shrank to chip / fallback / placeholder / paired-migration
  decisions, not "where does this code live".
- Plan inherited AFK/HITL slicing patterns (vertical
  observable-behaviour cuts; HITL gates for live-Claude smoke). The
  4-task graph maps cleanly to the inherited topology.

Process lesson: follow-up looms naturally absorb less ideation
overhead because parent anchors carry forward. Reusable cue: when
the Spec agent sees `type-hint: bugfix` paired with a `parent:`
field in the project metadata (or the seed references a closed
parent loom), it should:
1. Explicitly enumerate inherited anchors in a top-of-decisions.md
   "Inheritance note" section (the pattern this loom established).
2. Short-circuit the foundational grilling questions about audience,
   UX bar, parity bar — those are already pinned by the parent.
3. Focus grilling on the iteration's specific decisions (here:
   Q01-Q05) rather than the foundational ones (parent Q01-Q03).

Source: `.loom/chat-streaming-fixes/decisions.md` Inheritance note
section + spec.md Constraints "Inherited from chat-ui-parity (in
force)" subsection.

## 2026-05-12 - chat-streaming-fixes - bug-fix loom pattern (seed pre-frames diagnoses)

The `seed.md` for chat-streaming-fixes carried explicit diagnoses
with file paths + line numbers for both bugs (bridge `:478`,
MessagesTimeline `:136`, bridge `:501` as bug-2 root cause). This
pre-framing made Spec → Design → Plan move fast because the agents
were resolving "which of several known fix strategies do we take?"
(Q01-Q05), not "where does the bug live?"

Spec produced 5 questions, all answered in one batch with no
follow-up grilling. Design produced 7 ADRs in one pass with zero
open ambiguity at the gate. Plan produced a 4-task graph with zero
deferred-to-Build ambiguities.

Process lesson: bug-fix looms where the seed pre-frames diagnoses
with file:line citations collapse Spec faster than greenfield
feature looms. Reusable cue: when the Spec agent reads a seed that
includes file paths + line numbers in its bug descriptions, it
should:
1. Skip the "what is the problem" grilling questions — those are
   answered in the seed.
2. Open directly with "pick the fix shape" questions (Q01-style
   adopt/skip on polish, Q02-style choose-the-defense-layer,
   Q03-style codify-smoke-coverage).
3. Treat the seed's diagnoses as authoritative for that loom's
   spec.md `## What we're building` and `## Out of scope` sections
   without re-litigating the diagnosis.

The Spec agent for this loom got Q01-Q05 right on the first pass —
worth surfacing the pattern so future bug-fix looms benefit
without trial-and-error.

Source: `docs/chat-streaming-fixes-seed.md` (the seed used here) +
`.loom/chat-streaming-fixes/decisions.md` Q01-Q05 question framing.

## 2026-05-12 - loom-ui - Prototype Exploration
**Skill:** explore-prototype
**URL:** http://localhost:5173
**Source scan:** yes (routes + types + backend HTTP/WS API)
**Pages discovered:** 12 mockup pages + LiveHome (connected & offline) + 1 real chat + LoomViewLive (offline) + New-project dialog = 20 captures
**User-guided additions:** user-directed Phase 2 — recapture loom-view-live with backend up (blocked: backend was offline mid-crawl), capture more live-chat states (blocked: same), capture sidebar variants (deferred for same reason); user framed analysis as **parity audit of production code**, not re-spec; user requested full Phase 3 source scan including backend HTTP/WS surface.
**What worked:** Reading App.tsx as the route ground-truth resolved tab-state confusion early (Settings sidebar items render but have no onClick — only Hooks is wired); single-message Phase 3 dispatch to Explore agent produced the full HTTP+WS+types surface in one pass, kept main-agent context lean; tagging buttons with synthetic data-test attributes via puppeteer_evaluate solved click failures on un-keyed React elements.
**Problems:** Backend went offline partway through crawl (port 7891 not listening; /api/* returns 500); could not capture LoomViewLive with real data, real-chat slash menu, or sidebar dynamic states. Per the skill's no-mutation discipline plus the production-code framing, I declined to start the backend myself.
**Proposed change:** Add a "Backend liveness preflight" line to Phase 1 setup in `orchestrator/explore-prototype/SKILL.md`: before crawling, hit `/health` (or the equivalent) and abort to Phase 2 to ask the user if the backend is down. Currently the skill verifies the URL is reachable but doesn't distinguish between "vite dev server up, backend down" and "fully up."

## 2026-05-12 - loom-ui-parity-gaps - Spec/Design/Plan process notes

The Spec subagent for this loom could not call `AskUserQuestion`
directly from the Task-dispatch subagent context (the harness only
exposes `AskUserQuestion` to the orchestrator's main loop). The
orchestrator surfaced the foundation + branching question batches on
the Spec agent's behalf and mirrored answers into `decisions.md`
answer-slots.

Net effect on this loom: zero — content fidelity preserved across all
12 questions, every answer landed in its slot with the verbatim quote
preserved. But the framework body text (`weave/phases/spec/phase.md`
and the AskUserQuestion docstring) repeatedly implies the Spec
subagent can call AskUserQuestion directly. That is a capability
contract the harness may or may not satisfy depending on the dispatch
context.

Reusable lesson: framework body text should state the dual-mode
reality. The Spec agent's responsibility is to *produce* the question
batch (with options + recommendation per the categories.md format);
who *issues* the AskUserQuestion call (orchestrator or subagent) is a
harness-level capability dependency. Documenting it removes a class
of "why didn't the Spec agent just ask?" confusion for future runs.

Source: `.loom/loom-ui-parity-gaps/decisions.md` Q1-Q12 (12 questions
resolved with full answer-slot fidelity); `quality-review.md` does
not record any Spec-side gap.

## 2026-05-13 - diff-features - Plan template should probe DOM-test capability up front

The diff-features weave produced eight component / route tests that
assert on source-text patterns (`expect(src).toMatch(/.../)`) rather
than rendered DOM behaviour. The pattern was forced by the existing
`ui/vitest.config.ts` declaring `environment: "node"` and an include
glob of `*.test.ts` only — no jsdom, no @testing-library/react, no
`.test.tsx` support. Every Build task that delivered a React
component (T-002, T-003, T-007, T-008) recorded the same deviation
("test filenames are `.test.ts` not `.test.tsx`; static-source
precedent").

The deviation should have been surfaced as a Constraint in
`spec.md ## Constraints` during the Spec phase, or sized as a
testing-strategy decision in the Plan phase. Neither phase asked the
question "does the verification environment support DOM testing for
the deliverables?" before sizing the test surface. The Plan template
should add a question along those lines so future weaves either
(a) declare the constraint and scope the test strategy accordingly,
or (b) decide whether to rework the harness as part of the slice.

The flip side: the project's vitest config could grow jsdom and
@testing-library/react support as a one-line follow-up. If that
happens, the static-source workaround stops being necessary and the
deviation disappears.

**Cross-references:** `.loom/diff-features/review.md` finding R-006
+ learning L-001; all four React-component tasks' done.md
"Deviations from task spec" sections;
`.loom/diff-features/tests.md` ## Verification environment
(which calls out node-test as the environment but doesn't flag the
DOM-test gap).

## 2026-05-13 - diff-features - ADR-deviation downstream: design-time refactor can become dead code

Design ADR-6 in diff-features added optional controlled `scope` /
`onScopeChange` props to `DiffPanelShellProps` so the worktree-panel
container could drive the toggle through the shell. T-002 (an
earlier task) implemented the controlled-scope plumbing. T-008 (a
later task) chose to inline the scope-toggle strip directly in
`DiffPanelContainer` and render `<BranchToolbar>` + `<DiffFileCard>`
without using the shell. T-008.done.md recorded the deviation with
rationale (the container has to own the layout for `<CommitDialog>`
placement anyway, so wrapping the shell would add a layer for one
render). Net result: ADR-6 plumbing has no production consumer.

The Design phase couldn't have known T-008 would deviate. The Plan
phase couldn't have either. But the *signal* of the eventual dead
abstraction was visible inside T-008's task spec: the container's
sibling components (`<CommitDialog>`, scope toggle, snackbar
bridging) all live in the container's layout, so the shell was
always going to be a thin wrapper. A Plan-phase check —
"are all of ADR-N's consumers still going to consume it after this
work-graph lands?" — would have caught the upcoming dead-code at
DAG-construction time.

**Cross-references:** `.loom/diff-features/design.md` ADR-6;
`.loom/diff-features/tasks/T-002.done.md`;
`.loom/diff-features/tasks/T-008.done.md` "Deviations from task spec"
#2; `.loom/diff-features/review.md` finding R-002.

## 2026-05-14 - composer-t3code-triggers - Spec/Design/Plan held up; Build dropped a contract Design had spelled out

Spec / Design / Plan landed clean: design.md §"Keyboard contract" explicitly listed the eight key behaviours (ArrowUp/Down menu nav, Tab/Enter accept, Escape latch, Backspace at chip right, ArrowLeft/Right over chip, Shift+Enter newline, bare Enter submit) and ADR-006 specified the `ComposerKeyboardPlugin` to register five `KEY_*_COMMAND`s on the Lexical editor and bubble `ComposerKeyIntent`s to the shell. Plan flagged the keyboard ACs as "Not auto-verifiable under cli-shell — HITL via T-010". Build never implemented the plugin: `ComposerEditor` declares an `onSubmit` prop and a `focus()` ref method but neither is wired; the textarea's prior `onKeyDown` was deleted with no replacement. The cli-shell gates (tsc + vite build + grep) had no visibility into the missing wiring. Pattern: when Spec/Design name a runtime contract that the chosen verification environment cannot exercise, Plan needs to make the HITL checklist enumerate each AC by line — and Build needs an explicit "Design §X is realised by file Y, lines Z" mapping table on the task's done.md so reviewers can spot the gap before HITL. Worth feeding into Build task contract: a per-task "contract-realisation map" field that pairs design ADRs / spec ACs to concrete code locations.

