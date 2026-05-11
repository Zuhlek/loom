# Recovery

The orchestrator validates every phase return before surfacing the rerun-or-continue decision.

## Failure Modes

| Mode | Action |
| --- | --- |
| Malformed return | Redispatch once with the schema error and expected shape |
| Missing artifact | Redispatch once with the missing path list |
| Invalid artifact | Surface the rerun-or-continue decision; suggest `Run quality check` if Idea |
| Failed phase | Leave status `failed` and ask the user for next action |
| HITL block | Leave status `blocked` and surface the blocking question |

## Redispatch Rule

Redispatch once for mechanical contract failure (malformed return, missing artifact). If the same phase fails validation again, surface the reason to the user and keep `Resume point` unchanged.

Do not edit a phase artifact to repair an agent return. The producing phase owns its files.

User-initiated reruns from the rerun-or-continue decision are NOT mechanical contract failures — they go through the full phase dispatch with prior artifacts as additional context (see `SKILL.md` §"Rerun-or-Continue Decision").
