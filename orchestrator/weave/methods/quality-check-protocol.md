# Quality Check Protocol

Shared shell for the four opt-in quality-check agents (Spec, Design, Plan, Build). Each `phases/<phase>/quality-check.md` carries only the phase name, a one-line purpose, the phase-specific `## Checks` table, and a cross-reference back to this protocol.

Spec, Design, and Build QCs have **narrow in-phase scope** — they audit only their own phase's artifacts. The Plan QC has **comprehensive cross-phase scope** — it audits the full pre-Build artifact set (Spec + Design + Plan together) because Build is the irreversible-action boundary. Review has no QC agent because Review is itself the project-level quality check.

## Opener

Opt-in subagent that analyzes the phase's artifacts and reports whether a Refine would meaningfully change the result.

The orchestrator dispatches the matching QC agent **only** when the user picks `Run quality check` at the gate. It is not part of the mandatory phase cycle; its purpose is to inform the user's Refine decision.

The agent looks for evidence that proceeding to the next phase would surface contradictions the next phase cannot resolve — see each phase's `## Checks` table.

If no finding lands in any category, status is `passed` and the agent recommends `Continue`. A passing check is a short Summary + `Continue` recommendation — invent no findings to pad it; think fully, report briefly.

## Output: `quality-review.md`

```markdown
# Quality Review — <phase>
**Run at:** <iso-timestamp>
**Phase artifacts:** <artifact list>

## Summary
<one-paragraph verdict + refine-worthiness signal>

## Findings

### <severity>: <one-line title>
- **Owner phase:** <phase>  (for cross-phase QCs only; in-phase QCs omit)
- **Evidence:** <file:section or quote>
- **Why it matters:** <one-line impact>
- **Suggested refine focus:** <what the refine should address>

(repeat per finding)

## Recommendation
<Continue | Refine> — <one-line reason>
```

## Severity vocabulary

Severities: `blocker`, `major`, `minor`, `note`. A `blocker` finding implies the next phase cannot consume the output; `major` implies a likely regression; `minor` / `note` are polish.

Findings also obey the triage in `methods/principles.md § Review checklist`: a two-sided finding whose benefit is a few lines is not a finding — omit it, the status quo wins. A mechanical fix (behaviour-preserving, no regression surface) states "apply, no decision needed" in its Suggested refine focus.

## User-Facing Decision

The agent does NOT call `AskUserQuestion`. It writes `quality-review.md` and returns. The orchestrator surfaces the gate with the findings preview (see `orchestrator/weave/SKILL.md § Refine-or-Continue Decision`). The Refine option in the re-asked gate automatically scopes itself to the findings (Targeted refine, per `SKILL.md`).
