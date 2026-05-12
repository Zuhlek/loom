# Audit Log

## 2026-05-12 - weave-framework-hygiene - retro-run-clean-pass

Review verdict: PASS. 0 blocker, 0 major, 0 minor findings on a 16-task
retro-run that codified six pieces of user feedback into Spec → Design →
Plan → Build → Review. All seven user stories (US-001..US-007) plus SR-01
realised on disk; sibling schemas extracted (12 new files), `validator`
prose swept from every surface except the hook filename, `_preamble.txt`
deleted, Direct Questions section removed, hook key collision closed
(`build` vs `build-task` now distinct in `VALID_STATUSES`), and four
`## Rerun Behavior` blocks propagated. No commits or destructive ops.
One process-learning note: retro-run worked as a recovery pattern, but
the friction that made retro necessary is itself worth `/tune`
attention — see `.loom/weave-framework-hygiene/feedback.md` for the
mitigations weighed (fast-path `/weave new`, `--scope refactor`
template, threshold doc).

## 2026-05-11 - loom-ui-phase-update - whitelist-pair-coupling-invariant

The change required updating two whitelists in lock-step: client
`KNOWN_ARTIFACTS` (`loom-view-live.tsx`) and server `ARTIFACT_FILES`
(`loom.ts`). The design.md doc made the invariant explicit ("ARTIFACT_FILES
must be a superset of KNOWN_ARTIFACTS"), and Build landed both edits in
one phase per Q2=B. This worked, but it's a textbook drift trap: a
future change that adds one artifact name to only one side will appear
to work in the short run (the file shows in the tree, the click does
nothing) and reads as a UI bug, not a missing whitelist entry. Two
plausible future moves:
- **Document the invariant** in a contract / lint rule (cheap, but
  relies on people reading it).
- **Single source of truth** — promote the list to a shared `@loom/...`
  constants module imported by both server and client. This is a real
  refactor with package-graph cost but eliminates the drift class.
The current change set didn't need to act on this; flagging it for
`/tune` curation as a candidate follow-up.

## 2026-05-11 - loom-ui-phase-update - single-layer-T-003-justification

T-003 ("server ARTIFACT_FILES whitelist") was a single-layer task —
ui-server only, no client-side companion in the same task. The Plan
contract requires that single-layer tasks carry an explicit
justification. T-003's spec included one: *"Single-layer (server-only)
justified: this is the one-line whitelist constant that gates disk
reads; per Q2=B the boundary was explicitly relaxed for this constant
only."* That justification ties back to the Idea-phase branching
decision and is verifiable at audit time — exactly the shape the
contract intends. Proof that the "single-layer requires justification"
rule from the Plan contract works in practice: the justification was
present, was specific, was tied to a decision artifact, and made the
audit trivial.

## 2026-05-11 - loom-ui-phase-update - first-attempt-green-on-mechanical-changes

All four tasks landed green on first attempt with zero retries. The
factors that made this possible:
- design.md included exact before/after snippets for every non-trivial
  edit (the `phaseStatesFor` rewrite, the `loom-view.tsx` ternary
  cascade rewrite, the two whitelist replacements).
- The Plan listed `files-likely-touched` accurately (no scope creep
  discovered at build time).
- The Idea-phase grep audit ("`PhaseId` consumers") was complete; no
  unexpected callers surfaced.
This is the design payoff: when the upstream phases produce concrete,
verifiable specs, Build becomes mechanical and Review becomes short.
Worth holding up as a reference shape for future small refactors.

## 2026-05-11 - phase-validators - single-invocation-lifecycle-mid-project

The orchestrator originally exited after each phase
(one-decision-per-invocation). Mid-project the user edited
`weave/SKILL.md` to loop until Review→done in a single invocation,
adding a `Lifecycle state` framework with `active` / `complete`
values. The phase-validators project spans both eras: Idea ran under
the exit-after-phase model (separate `/weave` invocations), then
Design / Plan / Build / Review ran under the loop-until-done model
(single `/weave` invocation). The seam was crossed cleanly because
`pipeline.md` is the canonical state surface and both orchestrator
modes read/write the same sections — the only added field on the new
model is `Lifecycle state`, which the existing parser was
forward-compatible with. This validates the "pipeline.md is canonical
state" architectural commitment: the orchestrator's own behavior can
change while in-flight projects continue without state-loss. Reusable
cue: when the orchestrator's loop semantics change, projects in
flight survive iff every modified section is additive on
`pipeline.md`.

## 2026-05-11 - phase-validators - recursive-orchestrator-self-edit

This project recursively edited the very orchestrator that drove
it — the three new `validator.md` files live under the same
`orchestrator/weave/phases/` tree that the orchestrator reads on
dispatch. No reload cycle was needed at any point because
`validator.md` is loaded by file presence (predicate-based dispatch:
"if `phases/<phase>/validator.md` exists, the user gets the
three-option rerun-or-continue surface"), not by code that requires
re-import. The recursion is shallow — the orchestrator didn't
dispatch the new validators against this project, it just authored
them — but the architectural invariant ("orchestrator surface is
file-presence-driven, not code-driven") is what made it safe to
self-edit. Reusable cue: predicate-based file-presence dispatch is
what enables an orchestrator to extend itself in-flight without a
restart cycle.

## 2026-05-11 - phase-validators - verbatim-duplication-as-deliberate-no-helper-tradeoff

The seed forbade shared helper files (`no shared helpers; each
validator.md is self-contained, like phases/idea/validator.md`). Q05
+ Q06 affirmed this — each new validator restates the same ~30 lines
of Output template + severity rubric + User-Facing Decision paragraph
+ RETURN YAML block. This violates P3 (Zero Duplication) on a
literal-line-count reading. The deliberate trade-off: extending the
validator family in the future (or editing the boilerplate) requires
touching all N files in lock-step, but the orchestrator dispatch path
stays trivial (no include / partial mechanism) and each validator
file is independently readable. The mitigation: T-007's grep gates
re-assert all the boilerplate per-file, so drift is caught at
next-rerun-or-CI time. Worth capturing because future contributors
may want to extract a `templates/validator-frame.md`; this entry is
the record that the current setup is *intentionally* duplicated, not
accidentally so. Reusable cue: P3 is *negotiable when the duplication
is by-design and gate-asserted*; flag for `/tune` re-evaluation if
the boilerplate ever grows past one screen or starts to drift in
practice.


## 2026-05-12 - chat-ui-parity - depth-2-subagent-dispatch-gap

Standard `phases/build/phase.md` work loop step 3 says the Build
Coordinator MUST dispatch a fresh Task subagent per task. In this
harness, subagents do NOT expose a Task/Agent primitive — depth-2
dispatch is impossible. First Build Coordinator returned `status:
blocked` cleanly without modifying the repo or the board.
Orchestrator (user-facing session) took over as Coordinator and
dispatched task-builders at depth-1. Outcome identical for the
project's purposes; the work-loop contract that gives each task a
fresh context is preserved either way (only the dispatch boundary
moves). Reusable cue: if a Build Coordinator pre-flight surfaces
no Task primitive, fall back to depth-1 dispatch from the
orchestrator session. The framework should either document
orchestrator-as-Coordinator as the canonical fallback path or
provide a depth-2 dispatch primitive in the subagent toolset.

## 2026-05-12 - chat-ui-parity - smoke-first-walk-pre-build-context-engineering

The 7-flow live smoke checklist (Spec ## Constraints, Q10 done-bar)
passed 7/7 on the first manual browser walk — no flow needed retry,
no T-NNN re-open, no rollback to a prior phase. Two plausible
contributors: (1) the autonomous Build's wire-mirror discipline
(T-010's `wire-mirror-drift.test.ts` proved 10 unions byte-identical
before T-011 ran) and (2) the upstream context-engineering depth —
heavy grilling on Q01..Q10 closed the ambiguities that would
otherwise have surfaced as live-smoke regressions. Bundle delta also
landed at the favourable end of the budget window (59.78 vs 60-80 KB)
so the ADR-005 escape valve was never needed. Reusable cue: when an
iteration lands first-walk smoke success, audit whether Spec invested
enough in grilling-Q depth to retire ambiguities before Build. Inverse:
first-walk smoke failure should prompt looking at whether Spec rerun
depth was sufficient.

## 2026-05-12 - weave-phase-folder-restructure - predecessor-undo discipline threaded forward end-to-end

The user supplied `predecessor-undo-note.md` at the Spec gate listing
per-file obsolete-vs-survives breakdown of uncommitted edits from the
predecessor `weave-framework-hygiene` project. The note was threaded
through every downstream phase: Spec ingested it as repo-context, Plan
surfaced it as a constraint in `plan.md` and pulled per-file callouts
into T-001 / T-002 task specs, Build consolidated to the final shape
rather than additively layering on the predecessor's edits. Every
Build task that touched a predecessor-edited file (T-001 cross-cutting
plus T-002 / T-005 per-phase) enumerates in its done.md which predecessor
edits survived (terminology updates like Validator → Quality Check) and
which were removed as obsolete (`*.return.schema.yaml` sibling-file
references, Load-Order step 6 loading the schema YAML, "Phase return
schema" rows in the renamed signature.md and README.md). Reusable cue:
when a project's working tree carries uncommitted edits from a
predecessor that is partially superseded, a per-file
obsolete-vs-survives note at Spec gate consumed by Plan as a constraint
and threaded into cross-cutting task specs prevents the
"additively-edited on top of half-obsolete edits" failure mode that
otherwise breaks ref-sweeps at the end of Build.

## 2026-05-12 - weave-phase-folder-restructure - convention-exempt files still participate in ref-sweep

ADR D-06 exempted Spec's reference docs (`methods/categories.md`,
`methods/grilling.md`, `methods/stories.md`) from the
two-files-per-callable convention because they are not callables.
T-007's Layer D global ref-sweep nonetheless found 2 inline `agent.md`
cross-references in `grilling.md` pointing at the (now-renamed)
sibling Spec agent body. Build rewrote them to `phase.md` to satisfy
the ref-sweep. The distinction "exempt from convention shape" vs
"exempt from ref-sweep cleanup" was implicit, not explicit, in D-06.
Reusable cue: when a refactor renames siblings that
convention-exempt files cross-reference, the exempt files still need
ref-sweep updates. Audits should explicitly enumerate the ref-sweep
scope independently of the convention-shape scope so the two scopes
don't collapse into one "is this file in scope" question that lands
on the wrong side for one of them.

## 2026-05-12 - weave-phase-folder-restructure - review-as-project-quality-check landed clean

Review's audit checklist covered intent (US-001..US-007 acceptance
criteria, all observable on disk), design (ADR D-01..D-08 each with
concrete evidence), plan (board 7/7 done, all per-task done reports +
test logs present), test evidence (independently re-running Layer
A/B/C/D assertions), code quality (P3 zero-duplication enforced via
body cleanliness check), safety (HEAD unchanged, 9 renames as `R`,
hook untouched, no commits), and user feedback (predecessor-undo
note consumed correctly). Total: 0 blocker, 0 major, 0 minor. Two
notes recorded for the record (convention-exempt-ref-sweep and
predecessor-undo discipline). Reusable cue: when Build's
working-tree-change-report and test-report already enumerate the
verification layers with per-layer pass/fail, Review's role narrows
to independent re-execution of the load-bearing assertions plus
cross-checking that the ADR / story claims map to working-tree
observable evidence. The audit time is shorter than the build time
because the verification surface is already well-organized.

## 2026-05-12 - chat-ui-parity - smoke-coverage gap

A 7/7 live smoke run can still ship two crash-grade bugs if the smoke
flows do not exercise the partial-message-batch path or any tool whose
content-block index lands at >0. For chat-style projects: smoke
contracts should include a sustained-thinking turn, a TodoWrite-triggering
turn, and a multi-tool-in-one-turn flow alongside the canonical happy /
streaming / permission / AskQ / resume / interrupt / plan flows.

Source: chat-ui-parity follow-up loom `chat-streaming-fixes` opened
same day after first-dogfooding regressions.
