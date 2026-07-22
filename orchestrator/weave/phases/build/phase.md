# Build Phase Agent

Implement every ready task on the board, verify the runnable result, and aggregate evidence. Own build artifacts and repository changes for the entire phase within this single session.

## Reads

- `phases/build/methods/task.md` — per-task Red → Implement → Green → Done procedure, the three-attempt cap, the done-report schema, and the hard rules (no test weakening, no out-of-scope edits without recording, no destructive commands).
- `phases/build/methods/mutation.md` — per-task test-strength probe: select five to ten high-value mutation targets, apply one at a time, mark KILLED / SURVIVED / SURVIVED->KILLED / UNKILLABLE, add tests for real survivors without modifying existing tests.
- `phases/build/methods/smoke.md` — runnable verification: build-artifacts completeness, app-start, key endpoints / commands, UI screenshots when UI changed, shared-state integrity. Produces `smoke-report.md`.
- `methods/principles.md` — engineering principles P1–P7 the implementation must honour.

## Work Loop

0. **Verification-environment pre-flight.** Read `plan.md.Verification environment` (see Plan agent spec). Compare the declared environment against this agent's actual capability:
   - If the environment is executable here (e.g. `node-test`, `headless-browser`, `cli-shell` with the required runtime installed): proceed.
   - If the environment requires a harness this agent does not have (e.g. `manual-browser-desktop` on a non-GUI host, or a `headless-browser` harness without the binary): return immediately with `status: blocked`, list the env mismatch as the blocker reason, and do NOT promote any task to `In Progress`. The Plan-level contract MUST NOT be silently substituted.

1. Read the project artifacts `board.md` and `tests.md` from the workspace once at session start (the `principles.md` engineering principles arrive inlined — see `## Reads`, no disk read). Resolve the dependency order across tasks from `board.md` (`blocked-by` relations) and the per-task definitions in `tasks/T-*.md`.

2. **Loop over ready tasks in dependency order.** A task is ready when its `blocked-by` set is empty OR every blocker is already in `Done`.

   For each ready task:

   a. Read `tasks/T-NNN.md`. If `tasks/T-NNN.remaining.md` exists (a compaction checkpoint from an interrupted session — see `methods/task.md § Compaction checkpoint`), read it and resume from the recorded state instead of re-deriving the task's analysis.
   b. Note that this task is `In Progress` for purposes of reporting in the RETURN block; do NOT mutate `board.md`.
   c. Apply `task` — the Red → Implement → Green → Done procedure for this single task. The procedure is inline within this session; do not dispatch it as a subagent.
   d. Record the task outcome (`green` / `failed` / `hitl-block` plus attempt count and hitl-reason if applicable) for inclusion in the final RETURN block's `task-outcomes` array.
   e. When `tests.md` declares `**Mutation Testing:** yes` at the top AND the task reached `green`, apply `mutation` for this task. Inline within this session.
   f. Continue to the next ready task. As earlier tasks reach `Done`, previously-blocked tasks may become ready — re-read `board.md` between iterations to pick them up.

3. **Smoke.** When the project is runnable (per `design.md` / `plan.md`), apply `smoke` once after the per-task loop is exhausted. Whole-project verification; produces `smoke-report.md`. Inline within this session.

4. Record the smoke outcome (`ran: true|false`, `passed: true|false`) for inclusion in the final RETURN block's `smoke` field.

5. Write `test-report.md` aggregating per-task evidence with the smoke and (when applicable) mutation results.

6. Return the RETURN block defined in `phase.signature.md` › `## Returns` › `### RETURN block`.

## Reporting outcomes

This agent does NOT mutate `board.md`. The orchestrator owns the board: it reads the `task-outcomes` and `smoke` fields from this agent's RETURN block and applies the column transitions itself (see `orchestrator/weave/SKILL.md § Board transition mapping`).

Track task results in memory across the work loop. When this agent returns:

- `task-outcomes` must include one entry per task this session addressed (started, finished, failed, or HITL-blocked). Entries for tasks NOT addressed in this session are omitted — the orchestrator preserves their cards untouched.
- `smoke` reflects the smoke pass: `{ran: true, passed: true|false}` when smoke ran, or `{ran: false}` when the project was not runnable or smoke was deliberately skipped.

`tasks/T-NNN.done.md` remains the authoritative per-task record on disk; `task-outcomes` is its wire equivalent for the orchestrator's transition mapping.

A PostToolUse hook mirrors Build's per-task file writes (`tasks/T-NNN.test-log.txt`, `tasks/T-NNN.done.md`, `smoke-report.md`) into live board transitions for the UI — Build still never writes `board.md`. See `orchestrator/weave/SKILL.md § Board transition mapping § Live mirror via hook`.

## Refine scope

When re-dispatched via `Refine`:

- **Targeted refine (dynamic tail carries `Findings source: quality-review.md` or `review.md`):** read the named findings file and address every `blocker` and `major` finding before returning. Touch only the tasks a finding references. This agent still never writes `board.md` — report each re-worked task in `task-outcomes` with its fresh outcome; the orchestrator applies the column transitions per `SKILL.md § Board transition mapping`.
- **Light refine (`Findings source: none`):** leave finished work untouched. Pick the next eligible `Backlog` cards.

A "Full rerun" of Build is not exposed at the gate; achieving one requires the user to pick `Go back to Plan` first.

## Safety

- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Do not weaken tests.
- Fix implementation, not assertions.
- Keep output tail-sized (pipe verbose runners through `tail -100`).
