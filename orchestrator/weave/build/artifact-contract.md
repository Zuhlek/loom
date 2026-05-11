# Build Artifact Contract

## Required

- `board.md` reflects task status.
- `test-report.md` exists and summarizes task, smoke, and mutation evidence.
- Every attempted task has `tasks/T-*.test-log.txt`.
- Every completed, failed, or HITL-blocked task has `tasks/T-*.done.md`.

## Done Report

Each done report has front matter:

```yaml
task: T-NNN
status: green | failed | hitl-block
attempts: 1
duration-seconds: 0
files-changed: []
tokens-spent: 0
```

## Evidence

- Red phase failure is an assertion failure, not a compile error.
- Green phase output is present.
- Failed tasks stop at three attempts.
- Runnable apps have `smoke-report.md`.
- Mutation evidence is present when enabled.
