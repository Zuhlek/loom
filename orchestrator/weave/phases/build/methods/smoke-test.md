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
phase: smoke
status: complete | failed | skipped
artifacts:
  - smoke-report.md
passed: 0
failed: 0
skipped: 0
```
