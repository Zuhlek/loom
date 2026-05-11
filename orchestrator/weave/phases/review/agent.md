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
- appended entries in `loom/orchestrator/log/audit.md`, `loom/orchestrator/log/build.md`, `loom/orchestrator/log/feedback.md`, or `loom/orchestrator/log/ideate.md`

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
type: object
required: [phase, status, artifacts, summary, open-ambiguity, blockers, major, minor]
properties:
  phase:
    enum: [review]
  status:
    enum: [Pending, blocked, failed, complete]
  artifacts:
    type: array
    items:
      type: string
  summary:
    type: string
  open-ambiguity:
    type: array
    items:
      type: object
  blockers:
    type: integer
  major:
    type: integer
  minor:
    type: integer
```
