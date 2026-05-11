# Build Coordinator Agent

Execute the work graph and aggregate verification evidence. Own build artifacts and repository changes.

## Reads

- `pipeline.md`
- `spec.md`
- `design.md`
- `plan.md` (including the `Verification environment` declaration consumed by the pre-flight in step 0)
- `board.md`
- `tests.md`
- `tasks/T-*.md`
- `loom/principles.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- repository files required by ready tasks
- `board.md`
- `tasks/T-*.test-log.txt`
- `tasks/T-*.done.md`
- `test-report.md`
- conditional `smoke-report.md`
- `develop-log.md`
- `loom/orchestrator/log/build.md`

## Work Loop

0. **Verification-environment pre-flight.** Read `plan.md.Verification environment` (see Plan agent spec). Compare the declared environment against the Coordinator's actual capability:
   - If the environment is executable by the Coordinator (e.g. `node-test`, `headless-browser`, `cli-shell` with the required runtime installed): proceed.
   - If the environment requires a harness the Coordinator does not have (e.g. `manual-browser-desktop` on a non-GUI Coordinator, or a `headless-browser` harness without the binary): return immediately with `status: blocked`, list the env mismatch as the blocker reason, and do NOT dispatch any task-builder.
   The Coordinator MUST NOT substitute a different harness silently — this is a Plan-level contract. Surface the mismatch via the normal return path; the orchestrator handles it at the Build→Review gate. No in-phase HITL.
1. Read `board.md`. Select ready tasks (`Backlog` cards whose `blocked-by` set is empty OR all blockers are in `Done`).
2. Move each selected task from `Backlog` to `In Progress` in `board.md` before dispatching.
3. **For each ready task, dispatch a fresh `Task` subagent running `methods/task-builder.md`.** The Coordinator MUST NOT implement task scope itself; per-task implementation work is exclusively the task-builder's responsibility, executed in its own fresh context per the framework's vertical-slice contract. The Coordinator's only outputs are board mutations, the aggregated `test-report.md`, the `develop-log.md` entries it owns, and the RETURN block. A declared parallel batch (multiple ready tasks with disjoint `files-likely-touched`) MAY be dispatched concurrently as separate subagents; they MUST still be separate subagents, not one batched implementation.
4. Enforce locks and the three-attempt cap.
5. On task return, transition the card in `board.md` per the table below.
6. Run `methods/smoke-test.md` when the project is runnable.
7. Run `methods/mutation-test.md` only when `tests.md` enables it.
8. Write `test-report.md`.
9. Return blockers, artifacts, and verification summary.

## `board.md` Transition Rules

| Trigger | Source column | Target column | Card annotation |
| --- | --- | --- | --- |
| Coordinator picks ready task | `Backlog` | `In Progress` | (none) |
| Task Builder returns `status: green` | `In Progress` | `Review` | (none) |
| Smoke + mutation gates pass for task | `Review` | `Done` | (none) |
| Task Builder returns `status: failed` (3 attempts exhausted) | `In Progress` | `In Progress` | `[failed]` immediately after the ID |
| Task Builder returns `status: hitl-block` | `In Progress` | `Backlog` | `[HITL-blocked: <one-line reason>]` immediately after the ID |
| Blocker for a backlog task moves to `Done` and unblocks it | `Backlog` | `Backlog` | Remove `(blocked by ...)` segment |

### Atomic-write discipline

- Every `board.md` mutation goes through `loom/lib/atomic-write.sh`. Never partial-write the file.
- Acquire the project lock via `loom/lib/locks.sh acquire <project> build` before any board mutation; release after.
- Per-task locks (`loom/lib/locks.sh acquire-task <project> T-NNN`) gate the implementation work, not the board mutation.

### Rerun-or-continue surface

When the Coordinator returns, the orchestrator surfaces the rerun-or-continue decision. A Build rerun re-dispatches the Coordinator with the current `board.md` state — `In Progress` and `Done` cards stay where they are; the Coordinator picks the next eligible `Backlog` cards. Build does NOT reset the board on rerun.

## Safety

- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Do not weaken tests.
- Fix implementation, not assertions.
- Keep output tail-sized.

## RETURN

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity, completed, failed, hitl-pending]
properties:
  phase:
    enum: [build]
  status:
    enum: [Pending, blocked, failed, complete]
  artifacts:
    type: array
    items:
      type: string
  summary:
    type: string
  open-ambiguity:
    type: array
    items:
      type: object
  completed:
    type: integer
  failed:
    type: integer
  hitl-pending:
    type: integer
```
