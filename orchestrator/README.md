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
| `weave/<phase>/agent.md` | Phase agent contract |
| `weave/<phase>/schema.yaml` | RETURN block schema |
| `weave/<phase>/artifact-contract.md` | Per-phase artifact contract |
| `weave/idea/grilling-rules.md` | Idea-phase grilling discipline |
| `weave/idea/categories.md` | Question category templates + validation |
| `weave/build/*.md` | Build sub-agents (task-builder, smoke-test, mutation-test) |
| `weave/quality-check/` | Opt-in Quality Check subagent (Idea phase) |
| `tune/SKILL.md` | `/tune` meta-skill (feedback, review, insights) |
| `lib/` | Workspace helpers (pipeline parser, events, artifacts, locks, atomic write) |
| `hooks/` | Claude Code hooks |
| `types/` | Domain guidance loaded by Type hint |
| `templates/` | Project templates (seed, constitution) |
| `schemas/` | JSON schemas (pipeline, events, artifacts, lock) |
| `log/` | Learning shards appended by Review |
| `principles.md` | Engineering principles P1–P7 |

Run `./orchestrator/setup-loom.sh` to install skill symlinks and Claude Code hook wiring.
