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
