# Recovery

Mechanical contract failures (malformed RETURN blocks, missing declared artifacts, Plan work-graph violations) are enforced by the `SubagentStop` hook (`hooks/validate-subagent-output.py`) — the orchestrator runs no schema check of its own. The hook blocks the subagent from stopping and hands it the violation as the block reason, so the producing agent repairs its own return in-session. User-driven reruns are a separate path (see `SKILL.md` § Refine-or-Continue Decision).

## Failure Modes

| Mode | Enforcer | Action |
| --- | --- | --- |
| Schema mismatch / missing declared artifact / Plan graph violation | `SubagentStop` hook | The hook blocks the stop with the violation as the reason; the subagent fixes and returns again. No orchestrator involvement. If the subagent's session ends without a compliant RETURN despite the block (persistent failure), treat it as a hard failure: surface the hook reason to the user and exit — never silently re-dispatch. |
| Invalid artifact (exists, wrong content) | judgment | Surface the Refine-or-Continue decision; suggest `Run quality check` when the phase has a quality-check agent. |
| `failed` return | phase signature Throws | Leave status `failed`; surface per the signature's Throws row and ask the user for next action. |
| `blocked` return (HITL) | phase signature Throws | Leave status `blocked`; surface the blocking question, relay the answer per the signature (e.g. Spec's answer slots), re-dispatch. |

Do not edit a phase artifact to repair an agent return. The producing phase owns its files. Answer relay into `decisions.md` slots on a Spec `blocked` return is state relay licensed by the signature, not artifact production.
