# Build

Implement every ready task in `plan.md`, verify the runnable result, and record evidence. You own repository changes, the plan's task statuses, and `build-report.md`.

Read first: `plan.md`, `spec.md ## Constraints`, `<skill root>/principles.md`. Constraints override principles on conflict.

## Pre-flight

Compare `plan.md ## Verification environment` against what you can execute here. If the declared harness is not runnable (missing runtime, GUI-only gate on a headless host), return `blocked` naming the mismatch. Never substitute a different harness silently.

## Work loop

Loop over tasks in dependency order. A task is ready when every blocked-by task is `[done]`. Skip tasks marked `(HITL)`: set them to `[blocked]` with the note "HITL" and leave them for the user. Per task:

1. Set the task to `[doing]` in `plan.md ## Tasks`.
2. **Red.** Stub just enough for tests to compile. Write behavior tests from the task's test sketch. Confirm each new test fails with a runtime assertion, not a compile or import error.
3. **Implement.** Smallest change that satisfies the task's acceptance criteria. Match prior art per principles. Do not touch files outside the task's scope without recording the reason in the task's evidence.
4. **Green.** Re-run the tests. On red, fix the implementation and retry; after three failed attempts set the task to `[failed]` and move on.
5. On green, set `[done]` and append to the task's section in `plan.md`:

   ```markdown
   **Evidence:** <date> - attempts: N - files: <changed>
   <red tail and green tail, each piped through `tail -20`>
   ```

6. If a test contract contradicts spec or design, set the task to `[blocked]` with the contradiction as a note and continue with other ready tasks; do not edit the test to pass.

## Smoke

When all ready tasks are terminal and the project is runnable, verify the whole:

1. Non-code assets (YAML, JSON, SQL, templates, static files) exist in the build output; bundlers do not copy them automatically.
2. The app starts without crashing.
3. Changed endpoints or commands respond with the right shape, not just without error.
4. Changed UI screens render; save screenshots to `<workspace>/smoke-screenshots/` via a headless browser.
5. Tests did not corrupt shared state (DB, fixtures, env files).

Write `build-report.md`: one PASS/FAIL/SKIPPED line with reason per smoke check, plus a task rollup (done/failed/blocked with one line each). Per-task evidence stays in `plan.md`, do not duplicate it.

## Hard rules

- Never weaken or delete tests to pass. Fix the implementation.
- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Pipe verbose runners through `tail` so output stays readable.

## Rerun

`plan.md` statuses are the starting point; done tasks stay done. Pick up remaining todo/failed/blocked tasks.

## Finish

End with:

```yaml
RETURN
phase: build
status: complete | blocked | failed
artifacts: plan.md, build-report.md
summary: <one line: tasks done/failed/blocked, smoke result>
pending-user-input: <only when blocked>
```
