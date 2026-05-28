# Loom

Loom is a phase-based development framework for AI-agent software work.

Primary command: `/weave`

Workspace: `.loom/<project>/`

State file: `.loom/<project>/pipeline.md`

## Lifecycle

| Phase | Agent | Output |
| --- | --- | --- |
| Spec | Spec Grilling Agent | `spec.md`, `decisions.md` |
| Design | Design Structuring Agent | `design.md`, optional `mockup/` |
| Plan | Work Graph Agent | `plan.md`, `board.md`, `task.md`, `tests.md`, `tasks/T-*.md` |
| Build | Build Phase Agent | implementation, task logs, done reports, `test-report.md` |
| Review | Review Audit Agent | `review.md`, `feedback.md` |

After every phase the orchestrator surfaces a rerun-or-continue decision to the user. Reruns are never automatic. Four of the five phases (Spec, Design, Plan, Build) additionally offer an opt-in Quality Check subagent that analyses artifacts for holes, blind spots, and contradictions to help the user decide whether a rerun is worth the token burn. Review is itself the project-level quality check and has no separate Quality Check subagent.

## Dispatch hierarchy

Every subagent in the Loom tree spawns from `/weave`. The orchestrator dispatches phase agents and (optionally, at any phase gate where the user picks `Run quality check`) the matching phase quality-check agent — Spec/Design/Build have narrow in-phase scope, Plan has comprehensive cross-phase scope — directly. Phase agents never dispatch their own children (Claude Code forbids sub-subagent dispatch). The Build phase agent walks the dependency graph in `board.md` within a single session, applying its three procedure files (`methods/task.md`, `methods/smoke.md`, `methods/mutation.md`) inline as it works. The single-injection-site property is what makes the cached-prefix contract in `orchestrator/weave/SKILL.md` § Dispatch concatenation enforceable: one place dispatches, one place owns the dispatch shape.

## Layout

| Path | Purpose |
| --- | --- |
| `orchestrator/weave/SKILL.md` | `/weave` entrypoint |
| `orchestrator/weave/signature.md` | `/weave` orchestrator I/O signature |
| `orchestrator/weave/methods/` | Orchestrator-internal methods (`find-project`, `create-project`, `recovery`) |
| `orchestrator/weave/phases/<phase>/phase.md` | Phase agent body — role, work loop, methodology, rerun behaviour |
| `orchestrator/weave/phases/<phase>/phase.signature.md` | Phase agent signature — trigger, params, returns (embedded RETURN-block YAML schema and on-disk writes), throws |
| `orchestrator/weave/phases/<phase>/methods/` | Phase-internal procedure files (when present) — read inline by the phase agent, not dispatched as subagents (e.g. Build's `task`, `smoke`, `mutation`) |
| `orchestrator/weave/phases/<phase>/quality-check.md` | Opt-in Quality Check agent body — present for `spec`, `design`, `plan`, `build`. Spec/Design/Build have narrow in-phase scope; Plan has comprehensive cross-phase scope. Review has none because Review is itself the project-level quality check |
| `orchestrator/weave/phases/<phase>/quality-check.signature.md` | Quality Check agent signature (one per phase QC) |
| `orchestrator/lib/` | Workspace helpers (pipeline parser, events, artifacts, locks, atomic write) |
| `orchestrator/hooks/` | Claude Code hooks |
| `orchestrator/types/` | Domain guidance keyed by Type hint; the active type is materialized into each workspace as `.loom/<project>/type-guidance.md` at project creation |
| `orchestrator/templates/` | Project templates (seed) |
| `orchestrator/weave/methods/principles.md` | Engineering principles P1–P7 (inlined into Build/Review dispatch heads) |

## Phase folder convention

Every callable under `orchestrator/weave/phases/<name>/` follows the same two-files-per-callable shape so the orchestrator can dispatch each callable identically and a reader can navigate any phase without learning a new layout:

| File | Required | Purpose |
| --- | --- | --- |
| `phase.md` | yes | Phase agent body — identity, work loop, methodology, rerun behaviour. Implementation only; carries no caller-visible-shape sections. |
| `phase.signature.md` | yes | Phase agent signature — `## Trigger`, `## Params`, `## Returns` (with `### Return block` carrying the fenced YAML schema and `### Writes` carrying per-file artifact rules), `## Throws`. Single source of truth for everything the caller sees. |
| `quality-check.md` | optional | Quality Check agent body (present for spec, design, plan, build; review excluded). Plan's covers cross-phase scope; the others are in-phase only |
| `quality-check.signature.md` | with `quality-check.md` | Quality Check agent signature; `## Params` includes every artifact the QC reads |
| `methods/` | when needed | Phase-internal files read inline by the phase agent. Build's `methods/` holds `task.md`, `smoke.md`, `mutation.md` as procedures the Build session applies at the relevant work-loop steps (not dispatched as subagents). Spec's `methods/` holds reference docs the Spec agent loads at the relevant question-shaping step. |

The two halves of a callable — body and signature — are concatenated at dispatch time into a single system prompt for the producing agent. The concatenation order (body first, then `\n\n---\n\n`, then signature) is specified in `orchestrator/weave/SKILL.md` Phase Cycle 3.

The formal RETURN-block schema lives inline in the signature, under `## Returns` › `### Return block`, as a fenced `yaml` block. The orchestrator's silent schema-compliance check extracts it from there.

Phase-internal procedure files (`phases/<name>/methods/`) are not dispatched as subagents — they have no signature pair and no RETURN block. They are read inline by the phase agent at the relevant work-loop step.

Run `./orchestrator/setup-loom.sh` to install skill symlinks and Claude Code hook wiring.
