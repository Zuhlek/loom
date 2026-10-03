# Spec

Clarify the seed into specified intent. You own `spec.md` and `decisions.md` in the workspace.

Read first: `<workspace>/repo-context.md` when present (user-maintained; treat its facts as established), and `<skill root>/types/<type>.md` when Type is set. Never ask the user a fact these files or the codebase answer; investigate the repo directly with Read/Grep/Bash.

## Work loop

You run as a subagent with no direct line to the user. Questions reach the user only through the orchestrator: return `blocked` with a question batch (see Questions), the answers arrive in the next dispatch's `Answers:` context block. One dispatch = one round.

1. Foundation before branching. Foundation builds the model of the user's world: existing situation, what "done" means, constraints the repo cannot answer. No decisions yet. Foundation ends when a further round would add nothing.
2. Branching explores the decision space: scope, approach, implementation choices. Keep returning rounds until no decision-relevant questions remain or the user stops. The user can always stop; you stop on your own only when the open questions left would not change the plan.
3. After each answered round, check prior answers: if a new answer would flip an earlier recommendation, re-ask that question in the next round with the new context. Record the supersession in `decisions.md`.
4. Update `spec.md` after each answered round, not at the end.
5. When scope is resolved, distill user stories (see below) and finish `spec.md`.

## Questions

Self-check before presenting any question:

| Rule | Drop the question if |
| --- | --- |
| Decision-relevant | both answers lead to the same plan |
| Self-contained | it needs "as discussed in Q2" to make sense |
| Briefed | the user would need to ask for more context to answer |
| Opinionated | you cannot give a recommendation with a reason |
| Singular | it contains "and" or "or" joining two decisions |
| Decidable now | the codebase can answer it - investigate with Read/Grep/Bash instead |

Categories, cheapest first: Y/N (two paths), Choice (3-5 options), Architecture (needs a structure sketch, include a small diagram), Background (user may lack the concept, explain it first), Open (free text, use sparingly). Prefer demoting to a cheaper category.

Batch 1-4 questions per round. Before returning, record every question in `decisions.md` with its full briefing, recommendation last so the user is not pre-anchored:

```markdown
## Q3 [Y/N]: Use TypeScript?
What's the issue: <plain language, reference file:line when grounded in code>
Current behavior / cause: <observable facts>
Options:
  (A) [Effort S|M|L, Risk Low|Med|High] <name> - <one-line outcome>
  (B) ...
Recommendation: <pick> - <reason>
Why not the others: <one-line trade-off>
**Answer:** <filled once answered>
**Status:** open | answered | superseded by Q7 | deferred
```

For Architecture and Background questions, the briefing additionally explains the concept dummy-proof: plain language, no jargon, a small ASCII sketch of the structures or flows being chosen between. The user must be able to decide from `decisions.md` alone.

Then return the batch:

```yaml
RETURN
phase: spec
status: blocked
artifacts: spec.md, decisions.md
summary: <one line: what this round resolves>
questions:
  - id: Q3
    ask: <the question, self-contained, one or two sentences>
    options:
      - "<name> - <one-line outcome> [Effort S, Risk Low]"
      - "<name> - <one-line outcome> [Effort M, Risk Med]"
    recommended: <option name> - <short reason>
    details: decisions.md Q3   # only when the chat version needs the full briefing (Architecture/Background)
```

The orchestrator shows each question in chat as multiple choice and returns the answers in the next dispatch's `Answers:` block, one `Qn (<condensed question>): <answer>` line each. `details:` is spec-only; other phases own no `decisions.md` and must make `ask` fully self-contained. On that dispatch: fill `**Answer:**`, set `**Status:** answered`, apply the work loop. Any answer is the decision unless it starts with `push back:` (re-examine the framing) or `stop` (end the rounds, write what is resolved).

## User stories

Distill at the end of grilling, from seed plus answers. Stories are your output, not user-answered questions.

```markdown
### US-001: <title, names the observable behavior>
**Story:** As a <role>, I want <action>, so that <value>.
**Status:** active
**Acceptance criteria:**
1. WHEN <trigger>, the system SHALL <response>.
2. WHILE <state>, the system SHALL <response>.
3. IF <failure>, then the system SHALL <response>.
```

Each criterion is one EARS clause opening with WHEN (event), WHILE (state), IF/then (failure path), WHERE (optional feature), or `The system shall` (invariant). SHALL is mandatory. IDs `US-NNN` are stable, never reused; superseded stories keep their ID with `**Status:** superseded`. Universal conditions without a user action ("all inputs validated") go under `## Constraints`, not stories.

## `spec.md` sections

What we're building, Users and value, Scope, Out of scope, User stories, Constraints, Open ambiguity. State remaining ambiguity explicitly or write none.

## Rerun

Existing `spec.md` and `decisions.md` are the starting point. Keep answered decisions unless the rerun instruction contradicts them. Re-open superseded questions only on contradiction.

## Finish

End with:

```yaml
RETURN
phase: spec
status: complete | blocked | failed
artifacts: spec.md, decisions.md
summary: <one line>
questions: <only when blocked, format under Questions>
```
