# Pre-Build Quality Check Agent

Opt-in subagent that audits the full pre-Build artifact set — `spec.md`, `decisions.md`, `design.md`, `plan.md`, `board.md`, `task.md`, `tests.md`, and `tasks/T-*.md` — and reports whether any prior-phase issue would cause Build to deliver the wrong thing or to thrash. This is the lifecycle's **cross-phase comprehensive** quality gate — it complements the in-phase QCs at Spec, Design, and Build (which audit only their own phase's artifacts) by catching cross-phase integration issues at the irreversible-action boundary (Build modifies the repository).

## Reads

- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.

## Checks

The agent looks for evidence that proceeding to Build would either burn tokens on the wrong work or surface contradictions Build cannot resolve.

| Layer | Check | What it surfaces |
| --- | --- | --- |
| Spec | Intent gaps | A `## User stories` entry that names a behaviour `decisions.md` did not actually settle; a constraint in `spec.md ## Constraints` that no story or task references. |
| Spec | Open ambiguity | `spec.md ## Open ambiguity` carries an item that downstream phases silently dropped instead of resolving. |
| Spec | Decision audit | A `decisions.md` slot whose `Status: answered` body contradicts the story it informs. |
| Design | Realisation gap | A `spec.md` story whose acceptance criteria are not addressable by anything in `design.md` (no component, interface, or data shape covers the behaviour). |
| Design | ADR completeness | An `Architecture decisions` block missing Context / Decision / Rationale / Alternatives, or whose Decision contradicts a Spec constraint. |
| Design | Surface drift | A `design.md` section that restates user-facing flows (those belong in `spec.md ## User stories`) — symptom of phase boundary violation. |
| Plan | Graph integrity | A cycle in `blocked-by` edges; a `blocked-by` referencing a task that doesn't exist. |
| Plan | Story coverage | An active `US-NNN` story from `spec.md ## User stories` has zero tasks with that ID in their `satisfies-stories` field. |
| Plan | Slice quality | A task that slices horizontally (e.g. "all DB migrations") instead of vertically (a thin end-to-end slice of one or more stories). |
| Plan | Frontmatter | A `tasks/T-NNN.md` missing required frontmatter fields per `phase.signature.md` › `## Returns.Writes`, including `satisfies-stories`. |
| Plan | HITL surfacing | A decision the autonomous-Build commitment would normally interrupt on is not represented as a variant in Plan. |
| Plan | Test coverage | A task lists `US-NNN` in `satisfies-stories` but its test sketch doesn't address the story's EARS acceptance criteria. |
| Plan | Verification environment | `plan.md ## Verification environment` declares a harness Build cannot execute on the active host; surface so the user can either change harness or accept a `blocked` Build. |

A finding at any layer points the user at the owning phase: Spec findings recommend `Go back to Spec`, Design findings recommend `Go back to Design`, Plan findings recommend `Refine`. The recommendation is advisory — the user makes the final call at the gate.

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
