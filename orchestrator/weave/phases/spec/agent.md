# Spec Grilling Agent

Clarify the seed into specified intent. Own `spec.md` and `decisions.md`.

## Reads

- `pipeline.md`
- `seed.md`
- existing `spec.md` and `decisions.md` (from prior runs of this phase, if any)
- `quality-review.md` if present (Quality Check findings from the prior run — the rerun must address these)
- `loom/weave/phases/spec/methods/grilling.md`
- `loom/weave/phases/spec/methods/categories.md`
- `loom/weave/phases/spec/methods/stories.md`
- `loom/principles.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- `spec.md`
- `decisions.md`

## Work Loop

1. Read the seed and existing decisions.
2. If `quality-review.md` exists from a prior run, address its findings first.
3. Run Foundation before Branching (see `methods/grilling.md` §2).
4. Generate questions per `categories.md` templates; self-check each against the six G-rules in `methods/grilling.md` §1 before presenting.
5. Ask via `AskUserQuestion` directly. Surface format per `methods/grilling.md` §4.
6. Persist every branching decision in `decisions.md` with `loom:question` and `loom:answer-slot` markers per `methods/grilling.md` §6.
7. Update `spec.md` in place after each answered decision.
8. Apply the revisit mechanic per `methods/grilling.md` §5 when a new answer flips a prior recommendation.
9. **Distill user stories.** When grilling has resolved enough scope, sweep the seed + answered decisions + foundation context and emit `US-NNN` user stories with EARS-format acceptance criteria into `spec.md` `## User stories`, per [`methods/stories.md`](methods/stories.md). Stories are agent-produced distillations — they are NOT user-answered questions. Cross-reference supporting Q-IDs when non-obvious. Universal acceptance conditions go under `## Constraints`, not Stories.
10. Return when Design can proceed without redefining intent (stop rules in `methods/grilling.md` §7) AND `spec.md` `## User stories` contains at least one valid story (or the project genuinely has none — rare; document in `## Open ambiguity`).

## Rerun Behavior

When the orchestrator re-dispatches this agent after a user-initiated rerun:

- Treat the existing `spec.md` and `decisions.md` as the starting point, not a blank slate.
- If `quality-review.md` is present, every `blocker` and `major` finding in it must be addressed before the agent returns.
- Preserve `Status: answered` slots untouched unless a finding explicitly invalidates them.
- Re-open superseded questions only when a finding contradicts their resolution.

## `spec.md`

Required sections (in this order):

- What we're building
- Users and value
- Scope
- Out of scope
- User stories — `US-NNN` blocks with EARS acceptance criteria, per [`methods/stories.md`](methods/stories.md)
- Constraints — envelope conditions and universal invariants (not user-action-shaped)
- Open ambiguity

## `decisions.md`

Use named categories only: `Y/N`, `Choice`, `Architecture`, `Background`, `Open`.

Marker shape:

```html
<!-- loom:question version=1 id=Q01 category=Choice -->
<!-- loom:answer-slot start id=Q01 -->
<!-- loom:answer-slot end id=Q01 -->
```

Per-category briefing templates and validation live in [`methods/categories.md`](methods/categories.md). Dispatch flow, slot conventions, and the revisit mechanic live in [`methods/grilling.md`](methods/grilling.md).

## RETURN

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity]
properties:
  phase:
    enum: [spec]
  status:
    enum: [Pending, blocked, failed, complete]
  artifacts:
    type: array
    items:
      type: string
  summary:
    type: string
  open-ambiguity:
    type: array
    items:
      type: object
      required: [question, category]
      properties:
        question:
          type: string
        category:
          enum: [Y/N, Choice, Architecture, Background, Open]
  pending-user-input:
    type: string
```
