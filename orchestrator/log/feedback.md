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
