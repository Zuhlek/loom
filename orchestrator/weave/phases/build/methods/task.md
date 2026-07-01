# Task procedure — Red → Implement → Green → Done

Inline procedure the Build phase agent applies once per ready task. Not dispatched as a subagent.

## Principles

Apply each principle in the inlined `methods/principles.md` (P1–P7), using its **Self-check during implementation** rule while writing code. Keep it in context across every task. `spec.md ## Constraints` (read at session start) overrides any principle conflict for this project.

## Per-task checklist

Copy this into your working notes for each task and tick as you go:

```
- [ ] RED logged (a runtime assertion failure, not a compile error)
- [ ] IMPLEMENT (smallest scoped diff; only files in files-likely-touched)
- [ ] GREEN logged (test now passes)
- [ ] done.md written with status: green | failed | hitl-block
- [ ] attempts <= 3 (else status: failed)
```

## Procedure

For task `T-NNN`:

1. **Red phase.** Create stubs sufficient for tests to compile. Write behaviour tests from the task's test sketch (`tasks/T-NNN.md`). Run the tests and confirm every new test fails with a **runtime assertion error** — not a compile error, not a missing-import error. Append the red output to `tasks/T-NNN.test-log.txt` (pipe verbose runners through `tail -100`).

2. **Implement.** Make the smallest scoped change that satisfies the task acceptance criteria. Match prior art per `principles.md` P2. Do not touch files outside the declared scope without recording the reason in the done report. When the implementation takes a deliberate simplification with a known ceiling, leave a one-line `loom:shortcut <ceiling>; <trigger>` comment at the site, per the convention in `methods/principles.md`.

3. **Green phase.** Re-run the tests. On green, append the green output to the test log. On red, return to step 2 and try again. Stop after **three** failed implementation attempts and record `status: failed` in the done report.

4. **Done report.** Write `tasks/T-NNN.done.md` per the schema below.

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

| Value | Meaning | Maps to (orchestrator transitions per SKILL.md) |
| --- | --- | --- |
| `green` | All tests in the task scope pass; done report written | `In Progress` → `Review` |
| `failed` | Three implementation attempts exhausted | Card stays `In Progress` with `[failed]` annotation |
| `hitl-block` | Test contract itself is wrong (contradiction with spec/design) — do not silently edit | `In Progress` → `Backlog` with `[HITL-blocked: <reason>]` |

## "Done" means all three

A task is done only when all three of these have happened — partial completion is not done:

1. Green phase: every test in the task scope passes.
2. `tasks/T-NNN.test-log.txt` contains both the red and the green output.
3. `tasks/T-NNN.done.md` exists with `status: green` (or `failed` / `hitl-block` for terminal non-green states).

## Writes

| Path | Owner | Notes |
| --- | --- | --- |
| `<repo>/...` | task scope | Implementation files needed to satisfy the task's acceptance criteria. Smallest scoped diff per `principles.md` P1. |
| `.loom/<project>/tasks/T-NNN.test-log.txt` | task | Red + green output, tail-sized. |
| `.loom/<project>/tasks/T-NNN.done.md` | task | Done report per the schema above. |
