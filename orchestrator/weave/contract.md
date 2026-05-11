# `/weave` Contract

I/O contract for the top-level Loom orchestrator. The orchestrator coordinates phase agents; it does not produce phase artifacts itself.

## Invocation

**Caller:** User typing `/weave [project-name | ticket-id | command | free text]` in Claude Code.
**Trigger:** Manual invocation, or auto-prompted by `hooks/auto-advance.sh` when a project is ready to advance.

## Inputs

| Name | Source | Required | Description |
| --- | --- | --- | --- |
| `$ARGUMENTS` | Slash command argument | optional | Project name, ticket ID, or free text used to resolve or create a workspace |
| `pipeline.md` | `.loom/<project>/pipeline.md` | required when resuming | Canonical state file; absence implies new workspace |
| `seed.md` | `.loom/<project>/seed.md` | required for new projects | Raw user input that seeds the Idea phase |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants surfaced to phase agents |
| Phase agent definition | `phases/<current-phase>/agent.md` | required at dispatch | System prompt for the phase Task |
| Phase methods | `methods/find-project.md`, `methods/create-project.md`, `methods/recovery.md` | conditional | Orchestrator-internal skills loaded per Load Order in `SKILL.md` |
| Phase validator | `phases/<phase>/validator.md` | opt-in only | Loaded when user picks `Run quality check` (currently Idea phase only) |

## State preconditions

- Either a `.loom/<project>/pipeline.md` exists (resume) OR the user supplies enough context to bootstrap a new workspace (create).
- The active phase in `pipeline.md` is one of `idea`, `design`, `plan`, `build`, `review`.
- `Phase status` is one of `Pending`, `blocked`, `failed`, `complete`.

## Outputs

The orchestrator does not own phase artifacts. It owns state transitions and the rerun-or-continue surface.

| Artifact | Target path | Description |
| --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | Updated sections: `Current phase`, `Phase status`, `Produced artifacts`, `Pending user input`, `Quality findings`, `Next valid action`, `Resume point`, `History` |
| `events.jsonl` | `.loom/<project>/events.jsonl` | Appended one line per orchestrator-observed event |
| `artifacts.json` | `.loom/<project>/artifacts.json` | Refreshed snapshot of `pipeline.md` artifacts list |
| `quality-review.md` | `.loom/<project>/quality-review.md` | Written by the phase validator when QC is invoked; orchestrator does not author it |

## State postconditions

After a successful continue:

- `pipeline.md.Current phase` advanced to the next phase OR set to `complete` after Review.
- `pipeline.md.Phase status` reset to `Pending` for the new phase.
- `Produced artifacts` and `History` updated.
- `events.jsonl` reflects the phase transition.

After a successful rerun:

- `pipeline.md.Phase status` set to `Pending`.
- Prior artifacts remain on disk (overwritten by the rerun, not deleted by the orchestrator).
- `History` records the rerun decision.

## Success criteria

One phase decision (continue or rerun) is completed per `/weave` invocation. The orchestrator exits after surfacing the decision and applying it.

## Failure modes

| Condition | Orchestrator response |
| --- | --- |
| Malformed phase RETURN block | Dispatch `methods/recovery.md` to re-elicit a conforming RETURN; do not advance state |
| User cancels at `AskUserQuestion` | Exit cleanly; pipeline state preserved |
| Workspace cannot be resolved or created | Dispatch `methods/find-project.md` or `methods/create-project.md` per Load Order; if both fail, report to user and exit |
| Phase validator returns `findings` | Surface findings in chat; ask the user to choose `Continue` or `Rerun phase`; do not act unilaterally |
| Phase agent returns `blocked` with `Pending user input` | Surface the relay question; write the answer back into the phase artifact on next dispatch |

## Methods available

- [`methods/find-project.md`](methods/find-project.md) — resolve an existing `.loom/<name>/` workspace from arguments or active workspaces.
- [`methods/create-project.md`](methods/create-project.md) — bootstrap a new workspace with `pipeline.md` + `seed.md`.
- [`methods/recovery.md`](methods/recovery.md) — re-dispatch a phase agent after malformed RETURN.

## Phases dispatched

In order:

1. [`phases/idea/agent.md`](phases/idea/agent.md)
2. [`phases/design/agent.md`](phases/design/agent.md)
3. [`phases/plan/agent.md`](phases/plan/agent.md)
4. [`phases/build/agent.md`](phases/build/agent.md)
5. [`phases/review/agent.md`](phases/review/agent.md)

Each phase agent is dispatched in a fresh `Task` session. The orchestrator never inlines phase agent content into its own context. See `SKILL.md` for the full Load Order and decision logic.
