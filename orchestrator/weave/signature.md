# `/weave` Signature

I/O signature for the top-level Loom orchestrator. The orchestrator coordinates phase agents; it does not produce phase artifacts itself.

## Trigger

**Caller:** User typing `/weave [project-name | ticket-id | command | free text]` in Claude Code.

**Invocation condition:** Manual invocation, or auto-prompted by `hooks/auto-advance.sh` when a project is ready to advance.

## Params

| Name | Source | Required | Description |
| --- | --- | --- | --- |
| `$ARGUMENTS` | Slash command argument | optional | Project name, ticket ID, or free text used to resolve or create a workspace. Unknown flags are silently ignored — the eval harness pre-stages `.loom/<project>/.answers.yaml` via `evaluation/answer-queue.py` rather than passing an orchestrator flag |
| `pipeline.md` | `.loom/<project>/pipeline.md` | required when resuming | Canonical state file; absence implies new workspace |
| `seed.md` | `.loom/<project>/seed.md` | required for new projects | Raw user input that seeds the Spec phase |
| Phase agent body | `phases/<current-phase>/phase.md` | required at dispatch | Body half of the phase agent's system prompt |
| Phase agent signature | `phases/<current-phase>/phase.signature.md` | required at dispatch | Signature half of the phase agent's system prompt, carrying trigger, params, returns (including the embedded RETURN-block YAML schema), and throws |
| Orchestrator methods | `methods/find-project.md`, `methods/create-project.md` | conditional | Orchestrator-internal skills loaded per Load Order in `SKILL.md` |
| Phase quality-check agent | `phases/<phase>/quality-check.md` + `phases/<phase>/quality-check.signature.md` | opt-in only | Loaded when user picks `Run quality check` at the current phase's gate. Available for Spec, Design, Plan, Build (4 of 5 phases). Spec/Design/Build QCs have narrow in-phase scope; the Plan QC has comprehensive cross-phase scope (audits Spec + Design + Plan together). Review has no QC because Review is itself the project-level quality check. |

### State preconditions

- Either a `.loom/<project>/pipeline.md` exists (resume) OR the user supplies enough context to bootstrap a new workspace (create).
- The active phase in `pipeline.md` is one of `spec`, `design`, `plan`, `build`, `review`.
- `Phase status` is one of `Pending`, `blocked`, `failed`, `complete`.
- `Lifecycle state` is one of `active`, `complete`. A workspace with `Lifecycle state = complete` does not redispatch; the orchestrator reports the lifecycle as done.

## Returns

The orchestrator does not own phase artifacts. It owns state transitions and the Refine-or-Continue surface.

### RETURN block

The `/weave` orchestrator does not itself return a structured block to a caller — it is a user-invoked slash command. The phase agents it dispatches each return their own RETURN block conforming to the schema embedded in their `phase.signature.md`. RETURN-block schema enforcement is the responsibility of the `SubagentStop` hook (`hooks/validate-subagent-output.py`), which blocks malformed returns visibly rather than via an orchestrator-side extractor.

```yaml
# /weave is a slash-command entrypoint, not a Task callable.
# It returns no structured block of its own.
# Phase agents return RETURN blocks conforming to their phase.signature.md schemas.
type: null
```

### Writes

| Artifact | Target path | Description |
| --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | Updated sections: `Current phase`, `Phase status`, `Lifecycle state`, `Produced artifacts`, `Pending user input`, `Quality findings`, `Next valid action`, `Resume point`, `History` |
| `quality-review.md` | `.loom/<project>/quality-review.md` | Written by the matching phase quality-check agent when QC is invoked at a phase gate; orchestrator does not author it |

After a successful continue:

- `pipeline.md.Current phase` advanced to the next phase OR set to `complete` after Review.
- `pipeline.md.Phase status` reset to `Pending` for the new phase.
- `Produced artifacts` and `History` updated.

After a successful Refine:

- `pipeline.md.Phase status` set to `Pending`.
- Prior artifacts remain on disk (overwritten by the Refine, not deleted by the orchestrator).
- `History` records the Refine decision.

A single `/weave` invocation drives the lifecycle from the current phase forward until one of these terminal states:

- `Lifecycle state` becomes `complete` (Review→done).
- The user cancels at a gate `AskUserQuestion` (pause — `pipeline.md` preserved; later `/weave` resumes).
- A hard failure occurs (recovery cannot resolve a malformed RETURN; workspace unresolvable).

Each per-phase Refine-or-Continue gate is a regular `AskUserQuestion` surfaced by the orchestrator; it is **not** a session boundary. `Continue` advances to the next phase in the same invocation; `Refine` re-dispatches the current phase in the same invocation.

## Throws

| Condition | Orchestrator response |
| --- | --- |
| Phase RETURN block fails schema-compliance check | `SubagentStop` hook (`hooks/validate-subagent-output.py`) blocks the dispatch with a `decision: block` reason; the user sees the failure and decides whether to rerun |
| User cancels at a gate `AskUserQuestion` | Pause: exit cleanly with pipeline state preserved at the current phase; a later `/weave` invocation resumes from there |
| Workspace cannot be resolved or created | Dispatch `methods/find-project.md` or `methods/create-project.md` per Load Order; if both fail, report to user and exit |
| Phase quality-check agent returns `findings` | Surface findings in chat; re-ask the gate so the user can pick `Continue`, `Refine` (auto-targeted to the findings), or `Go back to ⟨prior phase⟩` |
| Phase agent returns `blocked` with `Pending user input` | Surface the relay question; write the answer back into the phase artifact on next dispatch |
| User picks `Go back to <prior-phase>` at a gate | Set `Current phase` to the target; move current and downstream phase artifacts to `superseded/<timestamp>/`; re-dispatch the prior phase agent |
| `phase.md` or `phase.signature.md` missing at dispatch | Fail dispatch with `missing-file: phases/<phase>/<role>.md|<role>.signature.md` before any Task is started |

## Methods available

- [`methods/find-project.md`](methods/find-project.md) — resolve an existing `.loom/<name>/` workspace from arguments or active workspaces.
- [`methods/create-project.md`](methods/create-project.md) — bootstrap a new workspace with `pipeline.md` + `seed.md`.

## Phases dispatched

In order:

1. `phases/spec/phase.md` + `phases/spec/phase.signature.md`
2. `phases/design/phase.md` + `phases/design/phase.signature.md`
3. `phases/plan/phase.md` + `phases/plan/phase.signature.md`
4. `phases/build/phase.md` + `phases/build/phase.signature.md`
5. `phases/review/phase.md` + `phases/review/phase.signature.md`

Each phase agent is dispatched in a fresh `Task` session with the body+signature concatenated as the system prompt per the rule in `SKILL.md` › "Dispatch concatenation". The orchestrator never inlines phase agent content into its own context. See `SKILL.md` for the full Load Order and decision logic.
