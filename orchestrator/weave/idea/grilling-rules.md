# Grilling Rules

## Question Quality

Every question must satisfy:

1. Decision-relevant: a different answer changes the next step.
2. Self-contained: the user can answer without re-reading another artifact.
3. Briefed: context, options, and recommendation are present.
4. Opinionated: a recommendation is named and justified.
5. Singular: one decision per question.
6. Decidable now: required inputs already exist or can be gathered by the agent.

## Categories

| Category | Use |
| --- | --- |
| Y/N | Exactly two viable options |
| Choice | One-of-N decision with three to five options |
| Architecture | Structural decision with cascading consequences |
| Background | Information request needed before deciding |
| Open | Non-enumerable answer space |

## Stop Rules

1. Budget reached and ambiguity stable.
2. User indicates enough context.
3. Ambiguity still grows after budget.
4. Repeated unanswered questions.

## Revisit Rules

1. New answer flips a prior recommendation.
2. Prior trade-off no longer applies.
3. Prior assumption contradicted.
4. Prior scope decision obsolete.

## Answer Handling

- Direct answers update the matching answer slot.
- Pushback appends a revisit question when it changes a recommendation.
- Side requirements are captured in their own section.
- Deferred items are explicit and visible to Design.
