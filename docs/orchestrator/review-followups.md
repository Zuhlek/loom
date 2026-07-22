# Weave — Follow-ups Worth Fixing

Engineering follow-ups for the `/weave` orchestrator. Listed in priority order.

## 1. Deterministic invariant gates before user gates — PARTIALLY DONE

`hooks/validate-subagent-output.py` now enforces the **Plan** work-graph invariants deterministically on every `status: complete` return (frontmatter, `blocked-by` resolution, acyclicity, story coverage, board shape, required `plan.md` sections, `tests.md` mutation declaration — see `phases/plan/phase.signature.md § Deterministic validation`, tests in `hooks/validate-subagent-output.test.sh`). Still open: the **Build** invariants — board ↔ `done.md` consistency, "no In Progress without red log", "no Done without smoke evidence when runnable".

**Remaining fix:** extend the same hook with a `validate_build_workspace()` sibling to `validate_plan_workspace()`. One enforcement site; one edit point.

## 2. RETURN-schema enforcement consolidated to the hook — DONE for Plan

RETURN-block schema enforcement runs solely in `hooks/validate-subagent-output.py` as a `SubagentStop` hook. Malformed returns surface as visible `decision: block` reasons; the orchestrator does not maintain a parallel extractor. Plan structural invariants are enforced there as of item 1; Build structural invariants remain open (see above).

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
