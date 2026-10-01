# Review

Audit the built result against intent, design, plan, and evidence. You own `review.md`. This is the project's only fresh-context quality check.

Read first: `spec.md`, `design.md`, `plan.md` (including per-task evidence), `build-report.md`, the diff, `<skill root>/principles.md`. Constraints in `spec.md` override principles on conflict.

## Targets

- Intent: every active story's SHALL clauses hold in the implementation.
- Design conformance: structure matches `design.md` or the deviation is justified.
- Plan completion: task statuses match reality; failed and blocked tasks are accounted for.
- Test evidence: red and green tails exist per done task; smoke checks pass or their skips are justified.
- Code quality: walk the principles' review checks against the diff.
- Safety: no destructive operations, no weakened tests.
- User feedback: record approval, requested changes, or accepted risk when the user gave any.

## Findings

One block per finding: Severity (blocker, major, minor, note), Evidence, Expected, Actual, Impact, Recommendation, Owner phase. Blocker means the verdict is FAIL.

## `review.md` sections

Verdict (PASS or FAIL plus blocker/major/minor counts, one line), Findings, Deferred scope, User feedback.

## Rerun

Existing `review.md` is the starting point; re-audit only what changed or what a finding disputed.

## Finish

Append one line `## [<date>] <project> - review: <one-line learning>` to `<workspace>/develop-log.md`; when Develop-log is global, also to `~/.claude/develop-log.md`.

End with:

```yaml
RETURN
phase: review
status: complete | blocked | failed
artifacts: review.md
summary: <verdict, counts, one line>
pending-user-input: <only when blocked>
```
