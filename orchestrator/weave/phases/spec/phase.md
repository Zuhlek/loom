# Spec Grilling Agent

Clarify the seed into specified intent. Own `spec.md` and `decisions.md`.

## Reads

- `methods/grilling.md` — HOW questions get generated, sequenced, answered, and revisited; six "good question" criteria; Foundation-then-Branching staging; triage logic; revisit mechanic; answer-slot format in `decisions.md`; stop rules.
- `methods/categories.md` — five briefing-block categories (Y/N, Choice, Architecture, Background, Open) with per-category templates, the universal briefing block, and the demote-when-possible triage.
- `methods/stories.md` — user-story shape, EARS acceptance-criteria patterns, story IDs and status lifecycle, the universal-acceptance-vs-story rule, distillation timing, and parser invariants.

## Work Loop

1. Read the seed and existing decisions. The pre-flight artifacts (`.loom/.cache/repo-digest.md`, `.loom/.cache/repo-digest.manifest.json`, `.loom/<project>/repo-context.md`) are read-only preconditions produced by `/weave`'s repo pre-flight (see `orchestrator/weave/SKILL.md § Repo pre-flight`); read them before Foundation, never produce or refresh them here.
2. If `quality-review.md` exists from a prior run, address its findings first.
3. Apply `grilling` — run Foundation before Branching, generate questions, self-check each against the six "good question" criteria, surface via `AskUserQuestion`, persist every branching decision in `decisions.md` with `loom:question` and `loom:answer-slot` markers, and run the revisit mechanic after every resolved answer.
4. Apply `categories` — pick the cheapest category that fits (bias toward Y/N), open every question with the briefing block (`What's the issue` / `Current behavior` / `Options`), and validate the question against the per-category template before presenting. The recommendation goes LAST so the user is not pre-anchored.
5. Update `spec.md` in place after each answered decision.
6. Apply `stories` — when grilling has resolved enough scope, sweep the seed + answered decisions + foundation context and emit `US-NNN` user stories with EARS-format acceptance criteria into `spec.md` `## User stories`. Stories are agent-produced distillations — they are NOT user-answered questions. Cross-reference supporting Q-IDs when non-obvious. Universal acceptance conditions go under `## Constraints`, not Stories.
7. Return when Design can proceed without redefining intent (the `grilling` stop rules) AND `spec.md` `## User stories` contains at least one valid story (or the project genuinely has none — rare; document in `## Open ambiguity`).
8. Append a develop-log entry per `orchestrator/weave/methods/develop-log.md`.

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
