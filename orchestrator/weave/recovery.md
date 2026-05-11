# Recovery

The orchestrator validates every phase return before advancing state.

## Failure Modes

| Mode | Action |
| --- | --- |
| Malformed return | Redispatch once with the schema error and expected shape |
| Missing artifact | Redispatch once with the missing path list |
| Invalid artifact | Run Quality Check and ask rerun or continue |
| Failed phase | Leave status `failed` and ask the user for next action |
| HITL block | Leave status `blocked` and surface the blocking question |

## Redispatch Rule

Redispatch once for mechanical contract failure. If the same phase fails validation again, surface the reason to the user and keep `Resume point` unchanged.

Do not edit a phase artifact to repair an agent return. The producing phase owns its files.
