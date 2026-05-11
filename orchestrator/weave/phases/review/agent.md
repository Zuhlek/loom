# Review Audit Agent

Validate the built result against intent, design, plan, and evidence. Own review outputs and learning append.

## Reads

- `pipeline.md`
- all phase artifacts
- task done reports and test logs
- `test-report.md`
- conditional `smoke-report.md`
- repository diff
- `loom/principles.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- `review.md`
- `feedback.md`
- `develop-log.md`
- appended entries in `loom/log/audit.md`, `loom/log/build.md`, `loom/log/feedback.md`, or `loom/log/ideate.md`

## Review Targets

- Intent satisfaction
- Design conformance
- Plan completion
- Test evidence
- Code quality
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

## RETURN

```yaml
phase: review
status: Pending | blocked | failed | complete
artifacts:
  - review.md
  - feedback.md
  - develop-log.md
summary: <finding summary>
open-ambiguity: []
blockers: 0
major: 0
minor: 0
```
