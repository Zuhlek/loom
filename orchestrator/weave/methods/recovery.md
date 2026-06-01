# Recovery

The orchestrator runs a silent schema-compliance check on every phase RETURN block before surfacing the Refine-or-Continue decision. Recovery covers the mechanical contract path: malformed returns, missing artifacts, and similar wire-shape failures. User-driven reruns are a separate path (see `SKILL.md` §"Refine-or-Continue Decision").

## Failure Modes

| Mode | Action |
| --- | --- |
| Schema-compliance mismatch | Silently redispatch once with the mismatch as the rerun instruction and the expected shape (extracted from `phases/<phase>/phase.signature.md` › `## Returns` › `### RETURN block` per `SKILL.md` Phase Cycle 3c) |
| Missing artifact | Silently redispatch once with the missing path list |
| Invalid artifact | Surface the Refine-or-Continue decision; suggest `Run quality check` when the phase has a quality-check agent |
| Failed phase | Leave status `failed` and ask the user for next action |
| HITL block | Leave status `blocked` and surface the blocking question |

## Redispatch Rule

Redispatch once for mechanical contract failure (schema-compliance mismatch, missing artifact). The first redispatch is silent — the user does not see the schema check happen unless it fails. If the same phase fails schema compliance again on the second attempt, surface the reason to the user and keep `Resume point` unchanged.

Do not edit a phase artifact to repair an agent return. The producing phase owns its files.

User-initiated reruns from the Refine-or-Continue decision are NOT mechanical contract failures — they go through the full phase dispatch with prior artifacts as additional context (see `SKILL.md` §"Refine-or-Continue Decision").
