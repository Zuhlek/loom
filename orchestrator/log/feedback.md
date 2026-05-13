# Feedback Log


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
