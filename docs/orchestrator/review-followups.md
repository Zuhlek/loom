# Weave — Follow-ups Worth Fixing

Engineering follow-ups for the `/weave` orchestrator. Listed in priority order.

## 1. Deterministic invariant gates before user gates

`hooks/validate-subagent-output.py:64-68` only checks flat-field presence (`artifacts`, `summary`). The structural invariants in `phases/build/phase.signature.md` — board ↔ `done.md` consistency, "no In Progress without red log", "no Done without smoke evidence when runnable" — have no runtime enforcement.

**Fix:** add `lib/weave-checks.py` running these invariants on phase artifacts. Wire it into `/weave` before surfacing the rerun-or-continue gate. Frame as "before user gate", not "before Review" — Review is itself the project-level QC (see `SKILL.md`).

## 2. RETURN-schema enforcement consolidated to the hook

RETURN-block schema enforcement runs solely in `hooks/validate-subagent-output.py` as a `SubagentStop` hook. Malformed returns surface as visible `decision: block` reasons; the orchestrator does not maintain a parallel extractor.

**Fix:** extend `hooks/validate-subagent-output.py` to enforce structural invariants beyond the flat-field check (board ↔ `done.md` consistency, "no In Progress without red log", "no Done without smoke evidence when runnable"). One enforcement site; one edit point.

## 3. Eval thresholds with fail conditions

`evaluation/analyze.py` measures Build outcomes but does not fail the eval on them.

**Fix in `evaluation/analyze.py`:**

- Fail if `tasks.done != tasks.planned`.
- Track output tokens per phase.
- Track retry counts and deterministic-gate failures (depends on items 1–2).

## Deferred (need refinement, not adoption)

- **Hard summary word caps.** Direction is right, but a hard cap on rerun summaries can starve recovery. Better as: "artifacts MUST be paths" (enforceable) + "summary SHOULD be ≤ N words" (soft).
- **Task context packets.** Adds a Plan-side artifact-generation step plus a packet schema to keep coherent with `spec.md`/`design.md`/`plan.md`. Pilot on one task type before adopting.

## Not adopted

- **Adding the Build inner loop to `SKILL.md`.** Misplaced. `/weave` is deliberately phase-agnostic. Build's inner loop belongs in `phases/build/phase.md`.
