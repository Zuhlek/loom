# Evaluation rubrics

Per-seed rubrics that pin down what a *correct* `/weave` run should and should
not produce. A rubric is a JSON file with an `expected_behavior` array of
concrete, checkable assertions tied back to the seed text and the canned answer
queue.

Current contents:

- `bookmarks.json` — rubric for the Bookmarks baseline seed (`../baseline-seed.md`
  + `../baseline-answers.yaml`). Covers the four core features, the five
  deferred decisions (and that they were *asked*, not silently chosen), the
  exact-stack constraints, workspace isolation, and the no-extra-features /
  no-auth scope discipline.

## Status — documented stub

This rubric exists as a hand-authored artifact only. It is **not yet consumed
by any automated grader**, and `run-baseline.sh` does not read it. It is checked
in now so the assertions are version-controlled and reviewable alongside the
seed they describe.

## Intended direction (future work)

Per the best-practices audit, the eval suite should grow in three directions.
These are deliberately deferred as larger design changes:

1. **A grader.** A scorer that loads a rubric, inspects a filed run under
   `analytics/<version>/<run>/` (the produced `spec.md`, `design.md`, the built
   `app/`, test output), and reports pass/fail per `expected_behavior` entry —
   feeding a regression score over time rather than eyeballing transcripts.
2. **A no-skill baseline.** Run the same seed through a plain model with no
   `weave` skill, score it against the same rubric, and report the delta so the
   skill's contribution is measurable rather than assumed.
3. **Multiple seeds.** Author additional seed scenarios (beyond Bookmarks) each
   with its own rubric here, to cover more of the project-type surface (typed
   vs untyped, greenfield vs bugfix, light vs deep Spec depth).

Until the grader exists, treat each rubric as the human reviewer's checklist
when reading a baseline run.
