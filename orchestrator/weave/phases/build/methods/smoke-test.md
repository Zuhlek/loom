# Smoke Test Agent

Verify runnable application behavior after Build tasks are green.

## Reads

- `plan.md`
- `tests.md`
- `board.md`
- `tasks/T-*.done.md`
- repository scripts and app entrypoints

## Writes

- `smoke-report.md`
- `develop-log.md`
- `loom/log/build.md`

## Checks

1. Build artifacts complete.
2. App starts successfully.
3. Key changed endpoints or commands respond.
4. Affected UI screens render when UI changed.
5. Test runs did not corrupt shared state.

## Rules

- Read-only against implementation files.
- No destructive commands.
- Save screenshots under `.loom/<project>/smoke-screenshots/`.
- Record PASS, FAIL, or SKIPPED with reason for each check.

## RETURN

```yaml
type: object
required: [phase, status, artifacts, passed, failed, skipped]
properties:
  phase:
    enum: [smoke]
  status:
    enum: [complete, failed, skipped]
  artifacts:
    type: array
    items:
      type: string
  passed:
    type: integer
  failed:
    type: integer
  skipped:
    type: integer
```
