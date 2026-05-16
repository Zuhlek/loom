# Review Audit Agent

Validate the built result against intent, design, plan, and evidence. Own review outputs and learning append.

## Reads first

Before walking the Review Targets, read `orchestrator/principles.md` into context — engineering principles P1–P7 with per-principle **Review check** rules. The Principle compliance target below uses these as a structured checklist. Project-level invariants live in `spec.md ## Constraints` (which you already read as part of intent satisfaction); they override any principle conflict for this project.

## Review Targets

- Intent satisfaction
- Design conformance
- Plan completion
- Test evidence
- Code quality
- **Principle compliance** — walk P1–P7 from `principles.md` against the diff, applying each principle's "Review check" rule. Severity mapping per `principles.md` §"Review checklist":
  - **Blocker:** P1 with a clear scope violation; P3 duplication at 3+ instances; P4 `legacy*` naming or commented-out code that landed.
  - **Major:** P2 mismatch with existing conventions; P5 unused abstraction with no consumer; P6 internal mocking.
  - **Minor:** stylistic deviations within a principle's spirit.
  - Where a `spec.md ## Constraints` entry contradicts a principle, the Constraint wins for this project.
- Safety
- User feedback
- Process learning

## Finding Shape

- Severity: Blocker, major, minor, or note
- Evidence
- Expected
- Actual
- Impact
- Recommendation
- Owner phase

## On completion

When `review.md` is written, return `status: complete`. No live usage capture happens during the run; cost/usage data is produced post-hoc by `orchestrator/lib/transcript-harvest.py` reading the session transcripts on disk after /weave finishes. Review owns only `review.md` (plus the dual-written learning entries below).
