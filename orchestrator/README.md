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
| Build | Build Coordinator Agent | implementation, task logs, done reports, `test-report.md` |
| Review | Review Audit Agent | `review.md`, `feedback.md`, `develop-log.md` |

After every phase the orchestrator surfaces a rerun-or-continue decision to the user. Reruns are never automatic. Four of the five phases (Spec, Design, Plan, Build) additionally offer an opt-in Quality Check subagent that analyses artifacts for holes, blind spots, and contradictions to help the user decide whether a rerun is worth the token burn. Review is itself the project-level quality check and has no separate Quality Check subagent.

## Layout

| Path | Purpose |
| --- | --- |
| `weave/SKILL.md` | `/weave` entrypoint |
| `weave/signature.md` | `/weave` orchestrator I/O signature |
| `weave/methods/` | Orchestrator-internal methods (`find-project`, `create-project`, `recovery`) |
| `weave/phases/<phase>/phase.md` | Phase agent body — role, work loop, methodology, rerun behaviour |
| `weave/phases/<phase>/phase.signature.md` | Phase agent signature — trigger, params, returns (embedded RETURN-block YAML schema and on-disk writes), throws |
| `weave/phases/<phase>/methods/` | Phase-internal callables (when present) — each follows the same body+signature pair shape (e.g. Build's `task`, `smoke`, `mutation`) |
| `weave/phases/<phase>/quality-check.md` | Opt-in phase Quality Check agent body — present for `spec`, `design`, `plan`, `build`; `review` has none (Review is itself the project-level quality check) |
| `weave/phases/<phase>/quality-check.signature.md` | Quality Check agent signature (spec/design/plan/build only) |
| `tune/SKILL.md` | `/tune` meta-skill (feedback, review, insights) |
| `lib/` | Workspace helpers (pipeline parser, events, artifacts, locks, atomic write) |
| `hooks/` | Claude Code hooks |
| `types/` | Domain guidance loaded by Type hint |
| `templates/` | Project templates (seed, constitution) |
| `log/` | Learning shards appended by Review |
| `principles.md` | Engineering principles P1–P7 |

## Phase folder convention

Every callable under `weave/phases/<name>/` follows the same two-files-per-callable shape so the orchestrator can dispatch each callable identically and a reader can navigate any phase without learning a new layout:

| File | Required | Purpose |
| --- | --- | --- |
| `phase.md` | yes | Phase agent body — identity, work loop, methodology, rerun behaviour. Implementation only; carries no caller-visible-shape sections. |
| `phase.signature.md` | yes | Phase agent signature — `## Trigger`, `## Params`, `## Returns` (with `### Return block` carrying the fenced YAML schema and `### Writes` carrying per-file artifact rules), `## Throws`. Single source of truth for everything the caller sees. |
| `quality-check.md` | optional | Quality Check agent body (present for spec, design, plan, build; review excluded) |
| `quality-check.signature.md` | with `quality-check.md` | Quality Check agent signature; `## Params` includes every file from `phase.signature.md`'s `## Returns.Writes` (param-validation interface) |
| `methods/` | when needed | Phase-internal callables — each method follows the same body+signature pair shape. Build's `methods/` holds `task.md`+`task.signature.md`, `smoke.md`+`smoke.signature.md`, `mutation.md`+`mutation.signature.md`. Spec's `methods/` holds reference docs (not callables; exempt from this convention). |

The two halves of a callable — body and signature — are concatenated at dispatch time into a single system prompt for the producing agent. The concatenation order (body first, then `\n\n---\n\n`, then signature) is specified in `weave/SKILL.md` Phase Cycle 3.

The formal RETURN-block schema lives inline in the signature, under `## Returns` › `### Return block`, as a fenced `yaml` block. The orchestrator's silent schema-compliance check extracts it from there.

The same shape recurses: a `phases/<name>/methods/<x>.md` can grow its own `methods/` if a callable becomes complex enough to be its own delegated unit.

Run `./orchestrator/setup-loom.sh` to install skill symlinks and Claude Code hook wiring.
