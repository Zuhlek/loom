# Hooks

Claude Code hooks keep Loom workspaces resumable and observable.

| Hook | Event | Purpose |
| --- | --- | --- |
| `resume-on-start.sh` | SessionStart | Surfaces active `.loom/*/pipeline.md` workspaces |
| `validate-subagent-output.sh` | SubagentStop | Validates phase RETURN blocks |
| `auto-advance.sh` | Stop | Continues one unblocked active workspace |
| `refresh-artifacts.sh` | PostToolUse | Rebuilds the workspace `artifacts.json` index after a file write |

Install through `orchestrator/setup-loom.sh`.
