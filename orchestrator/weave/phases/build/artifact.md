# Build Artifact Contract

## Required

- `board.md` reflects current task status across the four columns.
- `test-report.md` exists and summarizes task, smoke, and mutation evidence.
- Every attempted task has `tasks/T-*.test-log.txt`.
- Every completed, failed, or HITL-blocked task has `tasks/T-*.done.md`.

## `board.md` Invariants

- The four `## ` headers `Backlog`, `In Progress`, `Review`, `Done` still exist, in order.
- Every task that existed in the prior Plan `board.md` still exists in exactly one column (no cards lost).
- A task's column is consistent with its `done.md` status:
  - `status: green` → card in `Review` or `Done`.
  - `status: failed` → card in `In Progress` with the `[failed]` annotation.
  - `status: hitl-block` → card in `Backlog` with the `[HITL-blocked: ...]` annotation.
- No task is in `In Progress` without a `tasks/T-*.test-log.txt` recording at least one red attempt.
- No task is in `Done` without `smoke-report.md` evidence when the project is runnable.

## Done Report

Each done report has front matter:

```yaml
task: T-NNN
status: green | failed | hitl-block
attempts: 1
duration-seconds: 0
files-changed: []
out-of-scope-edits: []
```

## Evidence

- Red phase failure is an assertion failure, not a compile error.
- Green phase output is present.
- Failed tasks stop at three attempts.
- Runnable apps have `smoke-report.md`.
- Mutation evidence is present when enabled.
