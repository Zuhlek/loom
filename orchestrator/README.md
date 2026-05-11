# Loom

Loom is a phase-based development framework for AI-agent software work.

Primary command: `/weave`

Workspace: `.loom/<project>/`

State file: `.loom/<project>/pipeline.md`

## Lifecycle

| Phase | Agent | Output |
| --- | --- | --- |
| Idea | Idea Grilling Agent | `idea.md`, `decisions.md` |
| Design | Design Structuring Agent | `design.md`, optional prototype and mockup evidence |
| Plan | Work Graph Agent | `plan.md`, `board.md`, `task.md`, `tests.md`, `tasks/T-*.md` |
| Build | Build Coordinator Agent | implementation, task logs, done reports, `test-report.md` |
| Review | Review Audit Agent | `review.md`, `feedback.md`, `develop-log.md` |

Every phase is followed by the Quality Check Agent. The user then chooses whether to rerun the phase or continue.

## Layout

| Path | Purpose |
| --- | --- |
| `weave/SKILL.md` | `/weave` entrypoint |
| `weave/<phase>/agent.md` | Phase agent contract |
| `weave/<phase>/schema.yaml` | RETURN block schema |
| `weave/<phase>/artifact-contract.md` | Quality check input |
| `weave/build/*.md` | Build subagents |
| `lib/` | Workspace helpers |
| `hooks/` | Claude Code hooks |
| `types/` | Domain guidance loaded by Type hint |
| `templates/` | Project templates |
| `log/` | Learning shards appended by Review |

Run `./loom/setup-loom.sh` to install skill links and hook wiring.
