# Loom

Loom is a phase-based development framework for AI-agent software work.

Primary command: `/weave`

Workspace: `.loom/<project>/`

State file: `.loom/<project>/pipeline.md`

## Lifecycle

| Phase | Agent | Output |
| --- | --- | --- |
| Idea | Idea Grilling Agent | `idea.md`, `decisions.md` |
| Design | Design Structuring Agent | `design.md`, optional `mockup/` |
| Plan | Work Graph Agent | `plan.md`, `board.md`, `task.md`, `tests.md`, `tasks/T-*.md` |
| Build | Build Coordinator Agent | implementation, task logs, done reports, `test-report.md` |
| Review | Review Audit Agent | `review.md`, `feedback.md`, `develop-log.md` |

After every phase the orchestrator surfaces a rerun-or-continue decision to the user. Reruns are never automatic. The Idea phase additionally offers an opt-in Quality Check subagent that analyses artifacts for holes, blind spots, and contradictions to help the user decide whether a rerun is worth the token burn.

## Layout

| Path | Purpose |
| --- | --- |
| `weave/SKILL.md` | `/weave` entrypoint |
| `weave/contract.md` | `/weave` orchestrator I/O contract |
| `weave/methods/` | Orchestrator-internal methods (`find-project`, `create-project`, `recovery`) |
| `weave/phases/<phase>/agent.md` | Phase agent (RETURN schema inlined) |
| `weave/phases/<phase>/artifact.md` | Per-phase artifact contract |
| `weave/phases/<phase>/methods/` | Phase-internal methods (when present) |
| `weave/phases/idea/validator.md` | Opt-in Idea Validator (quality check) |
| `tune/SKILL.md` | `/tune` meta-skill (feedback, review, insights) |
| `lib/` | Workspace helpers (pipeline parser, events, artifacts, locks, atomic write) |
| `hooks/` | Claude Code hooks |
| `types/` | Domain guidance loaded by Type hint |
| `templates/` | Project templates (seed, constitution) |
| `schemas/` | JSON schemas (pipeline, events, artifacts, lock) |
| `log/` | Learning shards appended by Review |
| `principles.md` | Engineering principles P1–P7 |

## Phase folder convention

Every phase under `weave/phases/<name>/` follows the same shape so the orchestrator can dispatch each phase identically and a reader can navigate any phase without learning a new layout:

| File / folder | Required | Purpose |
| --- | --- | --- |
| `agent.md` | yes | Phase agent — role, work loop, and inline RETURN schema |
| `contract.md` | yes | I/O contract: what the orchestrator passes in, what comes back, success/failure modes |
| `artifact.md` | yes | Shape and required sections of the artifact(s) the phase produces |
| `methods/` | when needed | Phase-internal skills the agent dispatches (e.g. Build's `task-builder`, `smoke-test`, `mutation-test`) |
| `validator.md` | optional | Opt-in phase quality check (currently only Idea has one) |

Schemas are owned by the producer: the formal RETURN schema lives inline as a YAML block inside the producing `.md` file (agent, validator, or method). No separate `schema.yaml` files.

The same shape recurses: a `phases/<name>/methods/<x>.md` can grow its own `methods/` or a sub-`agent.md` if a method becomes complex enough to be its own delegated unit.

Run `./orchestrator/setup-loom.sh` to install skill symlinks and Claude Code hook wiring.
