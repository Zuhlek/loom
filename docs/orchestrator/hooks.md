# Hooks

Claude Code hooks keep Loom workspaces resumable and observable.

| Hook | Event | Purpose |
| --- | --- | --- |
| `resume-on-start.sh` | SessionStart | Surfaces active `.loom/*/pipeline.md` workspaces |
| `validate-subagent-output.sh` | SubagentStop | Validates phase RETURN blocks; on a Plan `complete` return additionally enforces the deterministic work-graph invariants (`phases/plan/phase.signature.md § Deterministic validation`) |
| `auto-advance.sh` | Stop | Continues one unblocked active workspace |
| `refresh-artifacts.sh` | PostToolUse (Write/Edit/MultiEdit) | Rebuilds the workspace `artifacts.json` index after a file write |
| `board-transition.py` | PostToolUse (Write/Edit/MultiEdit) | Live board mirror during Build — best-effort; the orchestrator's end-of-Build reconciliation stays authoritative |
| `lib/telemetry/tag-subagent-phase.py` | PostToolUse (Task) | Telemetry: tags each dispatched subagent's transcript with the active phase |

Install through `orchestrator/setup-loom.sh`. `hooks/settings.example.json` mirrors the wiring `setup-loom.sh` merges into `~/.claude/settings.json`.
