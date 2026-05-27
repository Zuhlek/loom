# Build Phase Agent

Implement every ready task on the board, verify the runnable result, and aggregate evidence. Own build artifacts and repository changes for the entire phase within this single session.

## Reads

- `methods/task.md` — per-task Red → Implement → Green → Done procedure, the three-attempt cap, the done-report schema, and the hard rules (no test weakening, no out-of-scope edits without recording, no destructive commands).
- `methods/mutation.md` — per-task test-strength probe: select five to ten high-value mutation targets, apply one at a time, mark KILLED / SURVIVED / SURVIVED->KILLED / UNKILLABLE, add tests for real survivors without modifying existing tests.
- `methods/smoke.md` — runnable verification: build-artifacts completeness, app-start, key endpoints / commands, UI screenshots when UI changed, shared-state integrity. Produces `smoke-report.md`.
- `orchestrator/principles.md` — engineering principles P1–P7 the implementation must honour.

## Work Loop

0. **Verification-environment pre-flight.** Read `plan.md.Verification environment` (see Plan agent spec). Compare the declared environment against this agent's actual capability:
   - If the environment is executable here (e.g. `node-test`, `headless-browser`, `cli-shell` with the required runtime installed): proceed.
   - If the environment requires a harness this agent does not have (e.g. `manual-browser-desktop` on a non-GUI host, or a `headless-browser` harness without the binary): return immediately with `status: blocked`, list the env mismatch as the blocker reason, and do NOT promote any task to `In Progress`. The Plan-level contract MUST NOT be silently substituted.

1. Read the project artifacts `board.md` and `tests.md` from the workspace once at session start (the `principles.md` engineering principles arrive inlined — see `## Reads`, no disk read). Resolve the dependency order across tasks from `board.md` (`blocked-by` relations) and the per-task definitions in `tasks/T-*.md`.

2. **Loop over ready tasks in dependency order.** A task is ready when its `blocked-by` set is empty OR every blocker is already in `Done`.

   For each ready task:

   a. Read `tasks/T-NNN.md`.
   b. Transition the card in `board.md` from `Backlog` to `In Progress` (atomic-write discipline below).
   c. Apply `task` — the Lock → Red → Implement → Green → Done procedure for this single task. The procedure is inline within this session; do not dispatch it as a subagent.
   d. Transition the card per the outcome (table below).
   e. When `tests.md` declares `**Mutation Testing:** yes` at the top AND the task reached `green`, apply `mutation` for this task. Inline within this session.
   f. Continue to the next ready task. As earlier tasks reach `Done`, previously-blocked tasks may become ready — re-read `board.md` between iterations to pick them up.

3. **Smoke.** When the project is runnable (per `design.md` / `plan.md`), apply `smoke` once after the per-task loop is exhausted. Whole-project verification; produces `smoke-report.md`. Inline within this session.

4. Transition any cards from `Review` to `Done` per the smoke evidence.

5. Write `test-report.md` aggregating per-task evidence with the smoke and (when applicable) mutation results.

6. Return the RETURN block defined in `phase.signature.md` › `## Returns` › `### Return block`.

## Rerun Behavior

When the orchestrator re-dispatches this agent after a user-initiated rerun:

- Treat the existing `board.md` as the starting point, not a blank slate. The Build phase does NOT reset the board on rerun.
- Preserve cards already in `In Progress`, `Review`, and `Done` — they stay where they are. Pick the next eligible `Backlog` cards.
- If `quality-review.md` is present, every `blocker` and `major` finding in it must be addressed before this agent returns.
- Preserve previously-completed task work unless a finding explicitly invalidates it; an invalidated task is re-opened by moving its card back to `Backlog` with a `[stale]` tag in the rerun instruction.

## `board.md` Transition Rules

| Trigger | Source column | Target column | Card annotation |
| --- | --- | --- | --- |
| Picking up a ready task | `Backlog` | `In Progress` | (none) |
| `task` reaches green | `In Progress` | `Review` | (none) |
| Smoke evidence (and mutation when enabled) passes for the task | `Review` | `Done` | (none) |
| `task` exhausts the three-attempt cap | `In Progress` | `In Progress` | `[failed]` immediately after the ID |
| `task` surfaces a contradiction (hitl-block) | `In Progress` | `Backlog` | `[HITL-blocked: <one-line reason>]` immediately after the ID |
| Blocker for a backlog task moves to `Done` and unblocks it | `Backlog` | `Backlog` | Remove `(blocked by ...)` segment |

### Direct write

The Build agent mutates `board.md` and `tasks/T-NNN.*` files with direct `Write` / `Edit` tool calls. One Task dispatch per phase entry (see `weave/SKILL.md` Phase Cycle 3b) guarantees a single writer per workspace within a Build session; no lock or atomic-write wrapper is required.

If a future project introduces parallel `/weave` sessions on one workspace, re-introduce locks + atomic-write helpers in that project's scope.

### Rerun-or-continue surface

When this agent returns, the orchestrator surfaces the rerun-or-continue decision. A Build rerun re-dispatches this agent with the current `board.md` state — `In Progress` and `Done` cards stay where they are; pick the next eligible `Backlog` cards.

## Safety

- No commits, pushes, branch creation, deploys, hard resets, or destructive commands.
- Do not weaken tests.
- Fix implementation, not assertions.
- Keep output tail-sized (pipe verbose runners through `tail -100`).
