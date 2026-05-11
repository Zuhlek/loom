# Hooks

Claude Code hooks keep Loom workspaces resumable and observable.

| Hook | Event | Purpose |
| --- | --- | --- |
| `resume-on-start.sh` | SessionStart | Surfaces active `.loom/*/pipeline.md` workspaces |
| `validate-subagent-output.sh` | SubagentStop | Validates phase RETURN blocks |
| `auto-advance.sh` | Stop | Continues one unblocked active workspace |
| `emit-events.sh` | PostToolUse | Appends lifecycle events and refreshes artifacts |
| `capture-task-start.sh` | PreToolUse Task | Records task dispatch start time |

Install through `loom/setup-loom.sh`.
