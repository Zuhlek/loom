# Weave Review — Follow-ups Worth Fixing

Items distilled from an external review of `/weave`. Listed in priority order.

## 1. Split Build sub-callable rows in transcript harvest

`lib/tag-subagent-phase.py:73,86` tags every Build-time subagent with `phase: build` (read from `pipeline.md.Current phase`). `build-task`, `smoke`, and `mutate` collapse into one phase bucket in `lib/transcript-harvest.py:369`.

The RETURN-block `phase` field already distinguishes them (`hooks/validate-subagent-output.py:10-19`); the harvest just doesn't read it.

**Fix:** in `transcript-harvest.py`, prefer the RETURN-block `phase` over the sidecar phase when present. Adds per-callable rows without changing the orchestrator.

## 2. Deterministic invariant gates before user gates

`hooks/validate-subagent-output.py:64-68` only checks flat-field presence (`artifacts`, `summary`). The structural invariants in `phases/build/phase.signature.md:62-101` — board ↔ `done.md` consistency, "no In Progress without red log", "no Done without smoke evidence when runnable" — have no runtime enforcement.

**Fix:** add `lib/weave-checks.py` running these invariants on phase artifacts. Wire it into `/weave` before surfacing the rerun-or-continue gate. Frame as "before user gate", not "before Review" — Review is itself the project-level QC (`SKILL.md:220`).

## 3. Real RETURN-schema extractor + validator

`SKILL.md:175-184` specifies the extraction rule (locate `### Return block` H3, parse the fenced `yaml`). Currently the orchestrator performs the check inside the agent prompt loop; nothing in code parses the schema.

**Fix:** implement the extractor once in `lib/`. Reuse from the PostToolUse hook, from `lib/weave-checks.py` (item 2), and from unit tests. Catches malformed RETURN blocks deterministically instead of via re-dispatch.

## 4. Eval thresholds with fail conditions

`evaluation/README.md:105` documents "Build coordinator inline-implements tasks" as a known limitation. The harness measures it but does not fail on it.

**Fix in `evaluation/analyze.py`:**

- Fail if Build fan-out collapsed (≤ 1 `build-task` row when `tasks.planned > 1`).
- Fail if `tasks.done != tasks.planned`.
- Track output tokens per callable (depends on item 1).
- Track retry counts and deterministic-gate failures (depends on items 2-3).

## Deferred (need refinement, not adoption)

- **Hard summary word caps.** Direction is right, but a hard cap on rerun summaries can starve recovery. Better as: "artifacts MUST be paths" (enforceable) + "summary SHOULD be ≤ N words" (soft).
- **Task context packets.** Adds a Plan-side artifact-generation step plus a packet schema to keep coherent with `spec.md`/`design.md`/`plan.md`. Pilot on one task type before adopting.
- **`parallel-batch-id` in Build signature.** Speculative — `/weave` dispatches one Task per orchestrator turn today. Parallel fan-out requires harness work, not a schema field. `promoted-tasks: [T-NNN]` alone is enough to enforce the existing `task.signature.md:9` dispatch seam.

## Not adopted

- **Adding the Build inner loop to `SKILL.md`.** Misplaced. `/weave` is deliberately phase-agnostic (`SKILL.md:14`). Build's inner loop belongs in `phases/build/phase.md`. The seam that needs enforcement (`task.signature.md:9`) is already specified.
