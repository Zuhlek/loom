# Task procedure — Red → Implement → Green → Done

Inline procedure the Build phase agent applies once per ready task. Not dispatched as a subagent. This procedure arrives inlined in the Build dispatch head (it is one of the Build body's `## Reads`); the agent applies it from the inlined head within its own session — no disk read.

## Principles

`methods/principles.md` (engineering principles P1–P7) is also inlined in the Build dispatch head — see the Build body's `## Reads`. Keep it in context across every task and apply each principle's **Self-check during implementation** rule while writing code. The project-level invariants live in `spec.md ## Constraints` (a workspace artifact already read at session start); that section overrides any principle conflict for this project.

## Procedure

For task `T-NNN`:

1. **Red phase.** Create stubs sufficient for tests to compile. Write behaviour tests from the task's test sketch (`tasks/T-NNN.md`). Run the tests and confirm every new test fails with a **runtime assertion error** — not a compile error, not a missing-import error. Append the red output to `tasks/T-NNN.test-log.txt` (pipe verbose runners through `tail -100`).

2. **Implement.** Make the smallest scoped change that satisfies the task acceptance criteria. Match prior art per `principles.md` P2. Do not touch files outside the declared scope without recording the reason in the done report.

3. **Green phase.** Re-run the tests. On green, append the green output to the test log. On red, return to step 2 and try again. Stop after **three** failed implementation attempts and record `status: failed` in the done report.

4. **Done report.** Write `tasks/T-NNN.done.md` per the schema below.

5. **Log.** Append one entry to `~/.claude/skills/develop-log.md` under the header `## [YYYY-MM-DD] — <project> — Task: <task-number>` with a `**Skill:** weave` body line.

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

## "Done" means all four

A task is done only when all four of these have happened — partial completion is not done:

1. Green phase: every test in the task scope passes.
2. `tasks/T-NNN.test-log.txt` contains both the red and the green output.
3. `tasks/T-NNN.done.md` exists with `status: green` (or `failed` / `hitl-block` for terminal non-green states).
4. `~/.claude/skills/develop-log.md` has a `## [YYYY-MM-DD] — <project> — Task: <task-number>` entry for this task.

## Writes

| Path | Owner | Notes |
| --- | --- | --- |
| `<repo>/...` | task scope | Implementation files needed to satisfy the task's acceptance criteria. Smallest scoped diff per `principles.md` P1. |
| `.loom/<project>/tasks/T-NNN.test-log.txt` | task | Red + green output, tail-sized. |
| `.loom/<project>/tasks/T-NNN.done.md` | task | Done report per the schema above. |
| `~/.claude/skills/develop-log.md` | task | One `Task: <task-number>` entry with `**Skill:** weave`. |
