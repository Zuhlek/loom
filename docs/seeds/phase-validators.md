# Seed — phase-validators

Add `validator.md` files for the four phases that don't currently have one: design, plan, build, review.

## Context

A recent refactor (commits 7245ceb, 5140312, 373acfe) standardized every phase folder under `orchestrator/weave/phases/<name>/` to the same shape:

- `agent.md` — the phase producer (system prompt + inline RETURN schema)
- `contract.md` — orchestrator↔agent delegation contract
- `artifact.md` — required shape of the artifact(s) the phase produces
- `methods/` — phase-internal skills the agent dispatches
- `validator.md` — opt-in quality check, dispatched in a separate Task only when the user picks `Run quality check`

Only `phases/idea/validator.md` exists today (a narrowed version of the prior generic quality-check agent). The four other phases are structurally ready to receive their own validators, but the validation content hasn't been authored.

The architectural intent is: validators are **producer-owned**, dispatched by the orchestrator in a fresh Task with the just-completed phase's RETURN block and artifacts. They never modify phase artifacts. They write `quality-review.md` and report findings; the orchestrator surfaces the findings preview to the user, who then chooses Continue or Rerun.

## What each validator should probably check

Rough scope per phase (the Idea phase will sharpen these):

- **design** — required sections per `design/artifact.md`; decisions from `decisions.md` addressed (none ignored or contradicted); constraints from `idea.md` respected; open ambiguity items concrete enough that Plan can consume them; coverage of every user-facing flow from `idea.md`.
- **plan** — graph integrity (no cycles, all `blocked-by` resolve, every behavior in `design.md` has at least one task); slice quality (vertical not horizontal); required frontmatter on every `tasks/T-NNN.md`; HITL surfacing (decisions that would otherwise interrupt Build are surfaced as variants in Plan, per the autonomous-Build commitment); `tests.md` covers the key behaviors.
- **build** — every task reached `Done` or there is a clear `failed`/`hitl-pending` list; `test-report.md` aggregates per-task results; `smoke-report.md` present when project is runnable; no tasks weakened or deleted (cross-reference test logs); no commits / pushes / destructive commands ran.
- **review** — Review IS the project validator, so this is a validator-of-the-validator: all Review Targets covered (intent, design conformance, plan completion, tests, code, safety, feedback, learning); findings have the required Finding Shape (severity, evidence, expected, actual, impact, recommendation, owner phase); severities used consistently; `develop-log.md` appended with process learnings; log shard appends made.

## Constraints

- Each validator follows the same RETURN schema as `phases/idea/validator.md` (`phase: quality-check`). Severities are `blocker`/`major`/`minor`/`note`. Recommendation is `continue`/`rerun`.
- Each validator writes only `quality-review.md` and the `Quality findings` / `Pending user input` / `Next valid action` sections of `pipeline.md`. No phase artifact modifications.
- No new orchestrator behavior. The dispatch mechanism (Task subagent triggered by user opt-in) stays as it is — the change is "validators exist for more phases now."
- No shared helper files. Each `validator.md` is self-contained, like `phases/idea/validator.md`.
- Pure structural addition. No regression in existing `/weave` flow.

## Open ambiguity

- Should `build/validator.md` run before or after the inline `methods/smoke-test.md` and `methods/mutation-test.md`? Those run during the phase as part of the work loop; the validator runs after the phase returns. So the validator probably reads `test-report.md` and `smoke-report.md` rather than re-running them — confirm.
- Is `review/validator.md` actually useful or is it redundant given Review's nature? User wants one, but the failure mode of "validator finds Review's findings are wrong" is worth pressure-testing during grilling.
- Each phase's validator title inside the file: `<Phase> Validator` ("Design Validator", "Plan Validator", etc.) — matches the `Idea Validator` precedent.

## Acceptance boundaries

- 4 new files: `orchestrator/weave/phases/{design,plan,build,review}/validator.md`.
- `orchestrator/weave/SKILL.md` Load Order updated to mention validators for all five phases (currently mentions only Idea).
- `orchestrator/weave/contract.md` updated to note all 5 phases have validators.
- `orchestrator/README.md` Layout table generalized from `phases/idea/validator.md` → `phases/<phase>/validator.md`.
- No regression in existing `/weave` Idea + quality-check flow.
- No new features beyond the four validators themselves.

## Out of scope

- Modifying the orchestrator's dispatch mechanism, Load Order semantics, or rerun-or-continue surface.
- Adding cross-phase validators or shared validator helpers.
- Changing the validator RETURN schema or `quality-review.md` shape.
- Promoting phase agents (or validators) to real Claude Code subagents.
