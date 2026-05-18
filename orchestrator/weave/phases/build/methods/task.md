# Task procedure — Lock → Red → Implement → Green → Done

Inline procedure the Build phase agent applies once per ready task. Not dispatched as a subagent. The agent reads this file at the start of each task and follows it within its own session.

## Reads first

Before the first task in this session, read `orchestrator/principles.md` into context — engineering principles P1–P7 — and keep it loaded across every task. Apply each principle's **Self-check during implementation** rule while writing code. The project-level invariants live in `spec.md ## Constraints` (already read at session start); that section overrides any principle conflict for this project.

## Procedure

For task `T-NNN`:

1. **Lock.** Acquire `.loom/<project>/.locks/T-NNN.lock` via `orchestrator/lib/locks.sh acquire-task <project> T-NNN`. The framework does not enforce this call; invoke it from a `Bash` tool call.

2. **Red phase.** Create stubs sufficient for tests to compile. Write behaviour tests from the task's test sketch (`tasks/T-NNN.md`). Run the tests and confirm every new test fails with a **runtime assertion error** — not a compile error, not a missing-import error. Append the red output to `tasks/T-NNN.test-log.txt` (pipe verbose runners through `tail -100`).

3. **Implement.** Make the smallest scoped change that satisfies the task acceptance criteria. Match prior art per `principles.md` P2. Do not touch files outside the declared scope without recording the reason in the done report.

4. **Green phase.** Re-run the tests. On green, append the green output to the test log. On red, return to step 3 and try again. Stop after **three** failed implementation attempts and record `status: failed` in the done report.

5. **Done report.** Write `tasks/T-NNN.done.md` per the schema below.

6. **Logs.** Append a build-task entry to `develop-log.md` AND to `orchestrator/log/build.md` (dual-write).

7. **Release.** Release the task lock via `orchestrator/lib/locks.sh release-task <project> T-NNN`.

## Hard rules

- **Red is runtime assertion failure**, not compile failure. A test that fails because the symbol does not exist is not red — stub the symbol first.
- **Do not weaken or delete tests to pass.** Fix the implementation. If the test contract itself is wrong, record `status: hitl-block` in the done report and surface the contradiction; do not silently edit the test.
- **Do not touch files outside the task's declared scope** without recording the reason in the done report under `out-of-scope-edits:`.
- **Three-attempt cap is hard.** After the third failed green attempt, write `status: failed` and stop. The next session can pick up where this one left off.
- **Tail-sized output.** Pipe verbose test runners through tail so the log stays consumable:

  ```bash
  npm test 2>&1 | tail -100 >> tasks/T-NNN.test-log.txt
  pytest 2>&1 | tail -100 >> tasks/T-NNN.test-log.txt
  ```

- **No commits, pushes, deploys, hard resets, or destructive commands.**

## Done report schema

`tasks/T-NNN.done.md` front matter:

```yaml
task: T-NNN
status: green | failed | hitl-block
attempts: 1
duration-seconds: 0
files-changed: []
out-of-scope-edits: []     # path + one-line reason per edit
notes: <optional one-paragraph remarks>
```

`status` semantics:

| Value | Meaning | Board transition |
| --- | --- | --- |
| `green` | All tests in the task scope pass; done report written | `In Progress` → `Review` |
| `failed` | Three implementation attempts exhausted | Card stays `In Progress` with `[failed]` annotation |
| `hitl-block` | Test contract itself is wrong (contradiction with spec/design) — do not silently edit | `In Progress` → `Backlog` with `[HITL-blocked: <reason>]` |

## "Done" means all five

A task is done only when all five of these have happened — partial completion is not done:

1. Green phase: every test in the task scope passes.
2. `tasks/T-NNN.test-log.txt` contains both the red and the green output.
3. `tasks/T-NNN.done.md` exists with `status: green` (or `failed` / `hitl-block` for terminal non-green states).
4. `develop-log.md` and `orchestrator/log/build.md` both have a matching entry.
5. The task lock has been released.

## Writes

| Path | Owner | Notes |
| --- | --- | --- |
| `<repo>/...` | task scope | Implementation files needed to satisfy the task's acceptance criteria. Smallest scoped diff per `principles.md` P1. |
| `.loom/<project>/tasks/T-NNN.test-log.txt` | task | Red + green output, tail-sized. |
| `.loom/<project>/tasks/T-NNN.done.md` | task | Done report per the schema above. |
| `.loom/<project>/develop-log.md` | task | Build-task entry, dual-written. |
| `orchestrator/log/build.md` | task | Matching entry for the global log shard. |
