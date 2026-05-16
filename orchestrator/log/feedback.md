# Feedback Log

## 2026-05-16 - baseline-1778916127-1 - non-interactive-run-no-live-feedback

Non-interactive baseline run — Review Audit Agent did not call
`AskUserQuestion` and gathered no live user feedback. Per harness
directive the `feedback.md` entry in the project workspace records
"automated acceptance pending downstream review." Review verdict
(PASS, 0 Blockers, 0 Major, 1 Minor, 1 Note) stands as the provisional
acceptance signal until a downstream human reviewer overrides.

Process observation: for non-interactive baseline runs, treat the
Review verdict's `feedback.md` synthesised entry as the source of truth
for the orchestrator's acceptance gate; subsequent live user feedback
should append a dated entry below the synthesised line rather than
overwriting it, so the timeline of "automated → human" acceptance is
preserved per project.


## 2026-05-12 - chat-ui-parity - heavy-spec-handin-light-plan-handin

User invested heavily on Spec (initial Q-batch + 2 reruns + 2 QC
passes = 4 touches) and then accepted Design and Plan with no rerun
and no QC ask (1 touch each at the gate). Build was 2 touches
(framework-gap workaround path + live smoke). Live smoke result:
7/7 on the first walk. Pattern reads as: heavy Spec polish at the
top of the funnel correlates with low rework downstream. The user
appears to trust Design and Plan agents once Spec is clean — which
suggests Spec is the most expensive-to-iterate-late artifact and
warrants the polish investment. Worth surfacing to `/tune feedback`:
if a project has frictionless Build, look at how many user touches
Spec absorbed — they may explain it. Inverse flag for future: if
Design or Plan rerun rate spikes, ask whether Spec was actually
clean before continuing. The Spec agent's recommendations on
rerun-vs-continue (recommended Continue both times) were overruled
by the user, who insisted on prose-level polish before advancing.
The user's instinct here proved correct (downstream rework was
zero); this is a signal worth feeding back into Spec validator
calibration.

## 2026-05-12 - chat-streaming-fixes - agent recommendation deviation paid off (Q04)

Spec Q04 asked which stable id keys the streaming assistant item:
(A) `session.currentTurnId` already in scope, single-row-per-turn,
or (B) `event.message.id` from a new `message_start` branch,
per-SDK-message row, or (C) hybrid.

The Spec agent recommended (A). The user explicitly chose (B) with
the rationale "matches t3code's per-SDK-message row UX." The
Decisions document captured the deviation with a note ("Deviation
from agent recommendation noted").

The user's call was load-bearing. T-004 smoke flow 10 (multi-tool
turn) validated that option B produces one timeline row per SDK
message, each carrying its own tool_use cards — matching t3code's
actual behaviour. Option A would have merged all SDK messages
within one user turn into a single row, regressing against t3code
parity even while fixing the crash.

Process lesson: when Spec Constraints invoke a named reference
(here: `docs/t3code-main/` via Q05's freeform comment), the Spec
agent's recommendation should weight "matches the reference"
higher than "fewer lines changed". The "safer" path sometimes
ships a correctness fix that simultaneously regresses against a
stated parity goal. Reusable cue: when an agent's recommendation
deviates from the user's pick AND the user cites a named-reference
parity goal as the reason, the recommendation engine should
re-rank the options against that parity constraint and either
shift its rec OR explicitly call out the rec-vs-parity trade-off.
The user shouldn't have to override silently — the agent should
surface that the "safer" rec costs the parity goal.

Source: `.loom/chat-streaming-fixes/decisions.md` Q04 and
`spec.md` Constraints (t3code reference invariant).

## 2026-05-12 - chat-streaming-fixes - Y/N answer freeform side-comment became load-bearing directive

Spec Q05 was a Y/N about back-amending the parent
`chat-ui-parity` spec with the new smoke flows. User answered NO
(keep parent terminal) and added a freeform side-comment: "Use
`docs/t3code-main/` as the reference when designing the
smoke-extension flow contents AND the chip UX (Q01) AND any
visual decision Design needs to make."

This side-comment ended up being more load-bearing than the Y/N
answer. It informed ADR-001 (chip placement), ADR-002 (chip
transition), ADR-005 (setInterval pattern), the smoke-flow content
for flows 8/9/10, and the explicit "t3code reference invariant"
Constraint.

Process lesson: Y/N questions sometimes attract freeform
side-commentary that introduces constraints broader than the
original Y/N scope. The Spec agent here captured the side-comment
into a Constraint (good), but a future Spec agent might miss this
and let the side-comment sit only in the answer slot, where Design
might not see it as a binding directive. Reusable cue: when a
Y/N answer carries a freeform addendum, the Spec agent should
echo the addendum into `## Constraints` (or `## Open ambiguity`)
explicitly so downstream phases treat it as load-bearing, not as
incidental commentary.

Source: `.loom/chat-streaming-fixes/decisions.md` Q05 resolution
and `spec.md` Constraints t3code-reference-invariant line.

## 2026-05-12 - composer-attachments-and-at-file - no-back-compat-in-fresh-codebase

User pushed back during Build on the coordinator's habit of adding
underscore-prefix renames (`_oldParam` / `_legacy*` / etc) to
existing parameters and variables as a backwards-compatibility tell.
The user's framing: this is a fresh codebase, there are no external
callers to preserve, the current name is the only name. Every diff
line should produce ONE clean version — no `_oldParam` renames, no
commented legacy, no duplicated old+new paths, no unreferenced shims.

The pushback aligns with `principles.md` P4 ("One clean
implementation, no backwards-compat shims") but is sharper: in a
fresh codebase the entire concept of "transitional shim" is wrong
even within the loose interpretation P4 allows. The Build coordinator
calibrated the rerun explicitly against this rule, the rerun's
8-card edit pass produced a single-version `ChatComposer.tsx`, and
Review confirmed clean against the working-tree diff for the loom's
claimed file set.

Calibration signal for the Build Task Builder and the Build
coordinator going forward: adopt the no-back-compat-in-fresh-codebase
default unless the `spec.md ## Constraints` section explicitly carves
out a wire-protocol / persisted-data back-compat clause. This
project's `Constraints` DID carve out wire-protocol back-compat for
`UserTurnFrame.body.images?` optionality and the legacy `user-turn`
emitter byte-compatibility — those are explicit per-project carve-outs
and take precedence over P4 per `principles.md` §"Review checklist".
The carve-out language is the right escape hatch when wire-protocol
or persisted-data forward-compat IS load-bearing; absent the
carve-out, the default is "one clean version".

Worth feeding to `/tune feedback`: P4's text should arguably tighten
to "no backwards-compat in fresh codebases unless a Constraint carves
it out". The current P4 text talks about "external callers" and "PR
transition periods" which leaves room for the coordinator to invent
back-compat where none is genuinely needed. The user's specific
pushback case — underscore-renames on private function parameters —
is well inside P4's spirit but not strictly forbidden by P4's text.

Source: `.loom/composer-attachments-and-at-file/feedback.md`,
orchestrator dispatch context 2026-05-12, Build rerun audit notes
in `develop-log.md` + `test-report.md`.

## 2026-05-13 — csd-717-swift-mapper-pr-feedback — user-pushback patterns

Patterns surfaced during the cycle. Full text + suggested /tune actions
in `.loom/csd-717-swift-mapper-pr-feedback/feedback.md`. Summary:

- **"No more clarifying questions" directive.** Issued mid-cycle and
  applies repo-wide for this user, not just to one phase. /craft Spec
  grilling should aim for one batched-question pass, not six sequential
  ones. Promote to permanent user memory.

- **"Structurally indifferent but reviewer-faithful".** When the
  reviewer proposes a structural change (img 12 hierarchy rename), user
  picks the *full* reviewer vision rather than the minimum that
  addresses the literal text. /craft grilling should frame options as
  "minimum / middle / full" with "full" tagged as reviewer-vision when
  applicable.

- **"Best-effort suggestion" preference.** User picks the
  recommendation column in 5 of 6 decisions.md grilling questions.
  Neutral option tables are a /craft anti-pattern for this user.

- **"Willingness to soften an AC when evidence contradicts".** On
  Design QC's ADR-08 vs US-008 AC1 contradiction, user softened AC1
  (byte-identity → semantics-preservation) rather than reshape ADR-08.
  QC review.md format should include "alternative: spec amendment" as a
  first-class resolution route alongside "rerun phase".

- **Existing pattern reconfirmed — "design push-back is expected".**
  User pushed back on QC's recommended "controlled duplication" path
  for ADR-08 with concrete reasoning grounded in reviewer img 12 intent.
  Existing memory captures this pattern; no update needed.

- **"Calvin-bmpi grounding load-bearing".** Q02 resolution would have
  been wrong without calvin-bmpi audit. Existing `feedback_calvin_bmpi_offlimits.md`
  memory says "read-only for audit"; should clarify "required reading
  when reviewer comments imply a legacy template the agent hasn't seen".

- **Process — done.md hygiene.** 5 of 10 AFK tasks shipped commits
  without done.md. The one Review-major (US-004 partial deletion)
  correlates with a missing T-006.done.md. Build contract should
  require done.md before RETURN composition.

Source: `.loom/csd-717-swift-mapper-pr-feedback/{review,feedback,develop-log}.md`,
plus `decisions.md` Q01-Q06 resolutions and `pipeline.md` History rows.

## 2026-05-14 - composer-t3code-triggers - verification-env pivot mid-Build + 5 smoke rounds accepted

User accepted three pivots and one deferral: (1) verification environment swap from `node-test` to `cli-shell` at Plan rerun (workspace's `%20`-encoded mount path broke `import.meta.url`-based static-source contract tests); (2) five rounds of follow-up smoke-fix tasks T-011 → T-014 covering placeholder color via `color-mix`, slash empty-state copy / catalog-empty branch, `@`-menu frame, Stop/Queue icon-only buttons, browse-mode top-5; (3) slash-command catalog deferred to a follow-up seed once smoke confirmed Loom does not yet ship `/help`/`/init`/`/settings`; (4) three incidental pre-existing wiring fixes folded into T-014 (cwd prop omission, missing `/api/` proxy prefix, walk.ts over-filtering). Pattern: user is willing to absorb several short rerun rounds on UI work where each round closes one or two visual smoke issues — preference is many small fixes over one batched-up "polish pass." Net new at Review: two blockers (deleted keyboard handler in Lexical swap; redundant slash-shell duplication) not yet on user's radar — need HITL decision before close.

## 2026-05-14 - fabric-details-overhaul - autonomous Review pass; no live user feedback captured

Review ran in `AUTONOMOUS MODE` per the dispatch contract — the agent did not call `AskUserQuestion` and decided every finding's severity itself. `feedback.md` for the project records "Autonomous run; no live user feedback captured". User has not yet ratified the verdict (Pass with accepted risk), the three Minors, or the one Note. Pattern observation: when Review runs autonomously the verdict-and-findings document is agent-judgement that the user must still ratify before lifecycle close — the framework currently has no explicit "user confirms autonomous Review verdict" gate, so any subsequent `/weave` invocation should surface the verdict to the user before treating Review as terminal.


## 2026-05-14 - skill-implicit-match-overfire - design-qc-standard-checks-miss-location-premise-scrutiny

Post-Design quality review used the standard six structural checks (sections, decisions, constraints, story coverage, duplication, ambiguity) and passed all six. The user nonetheless pushed back at the gate, asking why the on-disk session store had to live in `.loom/.sessions/` rather than `~/.claude/loom-sessions/` or `~/.loom/sessions/` or `/tmp/`. The QC's six checks scrutinise *shape* premises (flat-file vs. JSON manifest vs. inverse-key lock) but not *location* premises — and the three Spec-deferred candidates all pre-assumed `.loom/` as the parent, so the location premise was never independently weighed. Folding a seventh "location/path premise is justified, separate from shape" check into the QC template would have caught this in-phase. Recorded so /craft's QC method can be augmented.


## 2026-05-16 - baseline-1778919632-1 - non-interactive-run-verdict-as-provisional-acceptance

Second autonomous baseline run (after `baseline-1778916127-1`) where
the Review Audit Agent did not call `AskUserQuestion` and gathered no
live user feedback. `feedback.md` in the project workspace records
"automated acceptance pending downstream review"; the Review verdict
(PASS, 0 Blockers, 1 Major process, 1 Minor, 1 Note) stands as the
provisional acceptance signal for the orchestrator's acceptance gate
until a downstream human reviewer overrides it.

Convention reinforced (now across two runs): for non-interactive
baselines, treat the Review verdict's synthesised `feedback.md` line
as the source of truth for the acceptance gate. Subsequent live user
feedback should append a dated entry **below** the synthesised line
rather than overwriting it, so the "automated → human" acceptance
timeline stays preserved per project.

Worth surfacing to `/tune feedback`: as more baseline runs land
autonomously, the feedback shard accumulates "no live feedback"
entries that look like missing data but are actually a stable run
mode. Consider distinguishing `run-mode: autonomous` entries from
`run-mode: interactive` entries via a frontmatter tag, so feedback-
shard analysis can filter on real human signal vs. provisional
acceptance markers.

Reference: `.loom/baseline-1778919632-1/{feedback.md, review.md}`.

## 2026-05-16 - baseline-1778931123-1 - feedback not collected (autonomous run)

Run mode: autonomous. The Review Audit Agent dispatch context disables
`AskUserQuestion` and explicitly instructs `feedback.md` to record `not
collected (baseline eval run)`. The acceptance gate uses the Review
verdict (PASS, 0 Blockers, 0 Major, 3 Minor) as the provisional
acceptance signal until a downstream human reviewer overrides it.

Convention now consistent across at least three baseline runs: for
non-interactive runs, the synthesised `feedback.md` "not collected" line
plus the Review verdict in `review.md` are the source of truth for the
acceptance gate. Subsequent live human feedback should append a dated
entry below the synthesised line rather than overwriting it, preserving
the "automated → human" timeline per project.

Reinforces the prior shard note: `/tune feedback` should consider a
`run-mode: autonomous | interactive` frontmatter tag so feedback-shard
analysis can filter real human signal vs. provisional acceptance markers
— the autonomous entries are starting to dominate the shard tail.

Reference: `.loom/baseline-1778931123-1/{feedback.md, review.md}`.
