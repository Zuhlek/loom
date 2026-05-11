---
name: build
description: Execute a planned project from .forge/ with checkpointing and type-specific learning.
user-invocable: true
argument-hint: [type] <project-name> | forge
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion, TaskCreate, TaskUpdate, TaskGet, TaskList
---

# Build Skill

Pick up a planned project from `.forge/` and execute it task by task.

## Arguments

- `/build` — list all `.forge/*/` projects, show which have `.phase = done` (ready)
- `/build <project-name>` — execute the project
- `/build <type> <project-name>` — execute with type context (reads `~/.claude/skills/types/<type>.md`)
- `/build forge` — redirects to `/forge review` (unified forge skill)

## Setup

1. Read `.forge/<project>/plan.md` and `task.md`. Also scan the `.forge/<project>/` directory for any other reference files (scripts, configs, specs) placed during planning — use these as source of truth.
2. Verify `.phase = done`. If not, tell the user to finish planning first (`/idea <project-name>`)
3. Check `.forge/<project>/.build-phase` (`executing` → `wrap-up` ↔ `executing` → `built`) — if it exists, resume from that phase
4. If a type argument was given, read `~/.claude/skills/types/<type>.md` (if it exists) for accumulated execution guidance. **Type inheritance:** If the type file contains an `**Extends:** <parent-type>` declaration, read the parent type file first, then the child. Both inform execution. Child guidance takes precedence on conflicts.
5. **Resolve type (inherit first, ask second):** If no type argument was given, read `.forge/<project>/idea.md` — if it records a type (e.g., `**Type:** ciso-tool`), use that. Only if idea.md has no type: check `~/.claude/skills/types/` for existing types and ask via AskUserQuestion (list types + "Uncategorized"). If no type files exist, default to "uncategorized". Use the chosen type for all checkpoint log entries in this session.
6. Summarize the plan briefly and announce what will be built

## Execute

Set `.build-phase = executing`. Work through tasks from `task.md` in order. Check the **Parallelization** section — when tasks can run simultaneously, launch them as parallel Task subagents. Otherwise, execute sequentially.

For each task (or parallel batch):

1. Read the task's **Do / Files / Depends on / Tests / Done when**
2. Create or pick up the corresponding TaskCreate entry
3. **Red phase (TDD):** If `tests.md` exists in the project directory:
   a. **Create stub implementations first.** Before writing any tests, create the classes, interfaces, and method signatures referenced by the tests — but with empty or default-returning bodies (e.g., return `null`, `0`, `false`, or throw `UnsupportedOperationException`). The stubs must be sufficient for the tests to **compile**. A compilation failure is NOT a valid red phase — the red phase proves that the tests catch missing behavior through **runtime assertion failures**.
   b. Write the tests referenced in the task's `**Tests:**` field — implement them as actual runnable tests or verification checks.
   c. **Run the tests** — they must all compile and execute, and every test must **fail with an assertion error** (red). If a test passes against the stub, the test is not verifying real behavior — fix the test or add a meaningful assertion.
   d. Append a **Red** section for this task to `.forge/<project>/test-report.md`:
   ```markdown
   ## Task N — Red Phase
   | Test Name | Status | Error Message |
   |---|---|---|
   | [name] | FAIL | [assertion error output] |
   ```
4. **Implement:** Do the work — replace stubs with real logic, write remaining code, run commands, create files
5. **Green phase (TDD):** If tests were written in step 3:
   a. Re-run the task's tests — they must all pass (green)
   b. If any test fails: fix the implementation, **never modify the tests**
   c. Append a **Green** section for this task to `test-report.md`:
   ```markdown
   ## Task N — Green Phase
   | Test Name | Status | Error Message |
   |---|---|---|
   | [name] | PASS | — |
   ```
6. Verify the **Done when** criteria. If criteria can't be met, stop and ask the user — don't skip silently or guess a workaround.
7. **Checkpoint (mandatory decision):** After each task, explicitly decide: log or skip. If skipping, confirm the task went exactly as planned — no surprises, no deviations, no user corrections. When in doubt, log. A one-line "nothing notable" entry is better than a missing one.

**Parallel tasks:** Launch each as a Task subagent with the full task spec and project context. Wait for all to complete before moving to the next batch. Checkpoint after the batch.

**Sequential tasks:** Complete and checkpoint before starting the next.

## Checkpoint Log Format

Append to `~/.claude/skills/develop-log.md` (shared log at forge root):

```markdown
## [date] — <project-name> — Task: <task-number (from task.md, not TaskCreate ID)>
**Skill:** build
**Type:** [type or "uncategorized"]
**What worked:** [brief — what went smoothly]
**What didn't:** [brief — what was unexpected, slow, or wrong]
**Type knowledge:** [anything that should go into ~/.claude/skills/types/<type>.md — or "none"]
```

## Wrap-up

Set `.build-phase = wrap-up`. The build is not done after the last task — always complete wrap-up:

1. Use the type established during Setup (step 4 or 5) for tagging — don't re-ask.
2. Tag all log entries from this session with the type
3. **Integration tests (TDD):** If `tests.md` exists and has an "Integration Tests" section:
   a. Run all integration tests defined there
   b. Append an **Integration Tests** section to `test-report.md`:
   ```markdown
   ## Integration Tests
   | Test Name | Status | Error Message |
   |---|---|---|
   | [name] | PASS/FAIL | [error or —] |
   ```
   c. All integration tests must pass. If any fail: fix the implementation (go back to Execute for the relevant task), **never modify the tests**.
4. Run any additional verification (build, lint) to confirm tasks work together. Note failures.
5. **Application smoke test:** If the project modifies a runnable application (web server, CLI tool, etc.):
   a. **Build artifacts:** Run the production build and verify all runtime assets are present. Non-code files (YAML, JSON, SQL, HTML templates) are NOT copied by TypeScript — check that they exist in the output directory. If missing, fix the build script.
   b. **Start and probe:** Start the application and make HTTP requests (or CLI calls) to key endpoints — verify they return expected responses. Check both pre-existing functionality and newly added features.
   c. **Visual verification:** If the project added UI-visible features, use Puppeteer (or similar) to take screenshots and verify the feature is visible and correct from the user's perspective.
   d. **State integrity:** Verify that the test suite did not corrupt application state. Check DB config, files, and any persistent data that tests may have modified. Tests that DELETE or modify shared data without save+restore are bugs — fix them.
   e. Append a **Smoke Test** section to `test-report.md`:
   ```markdown
   ## Smoke Test
   | Check | Status | Details |
   |---|---|---|
   | Build artifacts complete | PASS/FAIL | [missing files or —] |
   | App starts successfully | PASS/FAIL | [error or —] |
   | Key endpoints respond | PASS/FAIL | [which endpoints checked] |
   | Visual verification | PASS/FAIL/SKIPPED | [screenshot summary or —] |
   | State integrity after tests | PASS/FAIL | [what was corrupted or —] |
   ```
   f. All smoke checks must pass before proceeding. If any fail: fix the issue (go back to Execute if needed), then re-run the smoke test.
6. **Mutation testing (optional):** If `.forge/<project>/plan.md` contains `**Mutation Testing:** yes`:
   a. **Analyze risk:** Read all files changed during this build. Identify mutation targets — prioritize by bug probability (complex logic, boundary conditions, error handling) and bug impact (data corruption, security, core business logic). Start with few, high-quality mutations.
   b. **For each mutation target:**
      i. `git stash push -m "pre-mutation-N"` to save clean state
      ii. Apply the mutation (operator replacement, boundary shift, condition negation, return value change, null check removal, argument swap)
      iii. Run the test suite
      iv. Record: **killed** (a test failed — good) or **survived** (all passed — test gap)
      v. `git stash pop` to restore clean code
   c. **Gap-filling:** For each surviving mutant:
      i. Write a new test that catches the mutation
      ii. Re-stash, re-apply mutation, run tests — confirm new test kills it
      iii. Revert mutation (`git stash pop`), keep the new test
      iv. If mutant genuinely can't be tested (logging, cosmetics), document why and mark as **unkillable**
   d. **Report:** Append to `test-report.md`:
      ```markdown
      ## Mutation Testing
      | # | Mutant Description | File:Line | Status | New Test Added |
      |---|---|---|---|---|
      | M1 | [what was changed] | [location] | KILLED/SURVIVED/UNKILLABLE | [test name or —] |

      **Summary:** N mutants created, N killed by existing tests, N killed by new tests, N unkillable.
      ```
   If `**Mutation Testing:**` is not set or set to `no`, skip this step entirely.
7. Brief summary of what was built
8. Ask if the user has feedback — if they want changes, set `.build-phase = executing`, go back to Execute, then return here
9. Set `.build-phase = built`

## Logging

After each session (or if the process itself had issues), append to `~/.claude/skills/develop-log.md` (shared log at forge root):

```markdown
## [date] — <project-name> — Process
**Skill:** build
**Type:** process
**What worked:** [what the skill handled correctly]
**Problems:** [what was unclear in SKILL.md]
**Proposed change:** [exact edit to SKILL.md or "none"]
```

Always check before responding. Skip the log entry only if nothing notable happened. Include one line for the user if notable:
> _Skill note: type file had outdated guidance on test patterns — logged._

**Never edit SKILL.md or type files directly.** Only log. All curation happens via `/forge review`.

## Rules

- **Follow the spec from `.forge/`.** But flag issues — if a task's spec is unclear or wrong, ask rather than guess.
- **Be opinionated during execution.** Make implementation choices, don't ask for every detail.
- **Don't over-engineer.** Do what the task says, not more.
- **Complete before moving on.** Finish each task (or parallel batch) and checkpoint before starting the next.
- **Type files are accumulated knowledge.** If the type file has guidance, follow it.
- **TDD red phase means runtime failures, not compile errors.** Create stub implementations (correct signatures, default return values) so tests compile. The red phase must show assertion failures from actually running the tests. "Cannot compile" is never a valid red result.
- **TDD: fix implementation, never tests.** If a test fails after implementation, the implementation is wrong — adapt it until all tests pass. Never modify a test to make it pass.
- **Mutation testing is optional.** Only run when `Mutation Testing: yes` is set in plan.md.
- **Don't commit or branch unless the user asks.** Version control is the user's responsibility.
