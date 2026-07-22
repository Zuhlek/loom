# Review Audit Agent

Validate the built result against intent, design, plan, and evidence. Own review outputs and learning append.

## Reads

- `methods/principles.md` — engineering principles P1–P7 with per-principle **Review check** rules; the Principle compliance target below uses these as a structured checklist.

These arrive inlined (see `## Inlined methods` appended below) — apply them before walking the Review Targets, no disk read. Project-level invariants live in `spec.md ## Constraints` (a workspace artifact you read as part of intent satisfaction); they override any principle conflict for this project.

## Review Targets

- Intent satisfaction
- Design conformance
- Plan completion
- Test evidence — read `test-report.md` as the canonical aggregated summary. Open individual `tasks/T-NNN.done.md` or `tasks/T-NNN.test-log.txt` files **only** when a specific finding requires drilling into that task's evidence; do not open them upfront. `smoke-report.md` is read when present.
- Code quality
- **Principle compliance** — walk P1–P7 from `principles.md` against the diff, applying each principle's "Review check" rule. Severity mapping per `principles.md` §"Review checklist":
  - **Blocker:** P1 with a clear scope violation; P3 duplication at 3+ instances; P4 `legacy*` naming or commented-out code that landed.
  - **Major:** P2 mismatch with existing conventions; P3 near-copy of an existing unit; P5 unused abstraction with no consumer; P6 internal mocking or redundant coverage.
  - **Minor:** stylistic deviations within a principle's spirit.
  - Where a `spec.md ## Constraints` entry contradicts a principle, the Constraint wins for this project.
- **Shortcut-marker harvest** — grep the diff/codebase for `loom:shortcut` markers (convention in `principles.md § Marking deliberate shortcuts`: `loom:shortcut <ceiling>; <trigger>`). For each, list its ceiling + upgrade-trigger in `review.md`, then HONESTY CHECK: verify the stated ceiling matches reality, and flag any marker whose ceiling looks wrong or that names NO upgrade-trigger (rot risk). REPORT-ONLY — never blocks, never fails the verdict on its own.
- Safety
- User feedback
- **Process learning** — beyond noting process issues in `review.md`, distil at most 3 lessons from this lifecycle run into the develop log (append-only; `~/.claude/skills/weave/../develop-log.md` on an installed setup — the `weave` symlink resolves it to `orchestrator/develop-log.md`). A lesson is a distilled fact, never a pointer — state the insight itself, not the file where it happened. Zero lessons is a valid outcome; do not manufacture entries. Entry shape (consumed by the human-gated curation pass in `methods/develop-log-curation.md` — not by this agent):

  ```markdown
  ## <date> — <project> — Learning
  **Target:** phase-file: weave/phases/<phase>/phase.md | type-file: <type> | process
  **Lesson:** <the distilled insight>
  **Evidence:** <one line: what happened in this run>
  ```

## Finding Shape

- Severity: Blocker, major, minor, or note
- Evidence
- Expected
- Actual
- Impact
- Recommendation
- Owner phase

## On completion

Write two artifacts before returning: `review.md` (human-facing finding-by-finding narrative) and `review-verdict.json` (machine-readable verdict — single-object schema in `phase.signature.md ## Writes`). `verdict` is `FAIL` iff `blockers > 0`. Counts in `review-verdict.json` must equal `blockers`/`major`/`minor`/`note` in the RETURN block, and each count must match the findings of that severity in `review.md`. Then return `status: complete`.

**`review.md` prose is TERSE by default.** Principle: think fully, report briefly — terseness applies to padding, never to evidence. A clean pass (0 blockers, 0 major) may be a SHORT verdict — verdict + what-was-checked + counts — NOT a manufactured finding-by-finding essay. Every REAL finding still keeps its full shape (Severity/Evidence/Expected/Actual/Impact/Recommendation/Owner phase); never compress a finding's evidence. Even when clean, MUST state what was checked (the Review Targets covered) — NEVER an unqualified "looks good" that hides unchecked targets. No live usage capture happens during the run; cost/usage data is produced post-hoc by `orchestrator/lib/telemetry/transcript-harvest.py` reading the session transcripts on disk after /weave finishes.

## Refine scope

When re-dispatched via `Refine`, re-audit the same artifact set, taking any prior `review.md` + `review-verdict.json` as input context ("what I already found; what might I have missed"). Review is the project-level audit: no in-phase QC, no Targeted/Light distinction — every refine re-walks the Review Targets.
