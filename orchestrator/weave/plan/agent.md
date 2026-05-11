# Work Graph Agent

Convert solution structure into an executable work graph. Own Plan artifacts.

## Reads

- `pipeline.md`
- `idea.md`
- `decisions.md`
- `design.md`
- optional evidence artifacts
- selected `loom/types/<type>.md`
- optional `constitution.md`

## Writes

- `plan.md`
- `board.md`
- `task.md`
- `tests.md`
- `tasks/T-*.md`
- optional `ticket.md`

## Work Loop

1. Extract user stories from Idea and Design.
2. Slice work vertically around observable behavior.
3. Assign stable `T-NNN` IDs.
4. Build a `blocked-by` DAG.
5. Mark tasks as `AFK` or `HITL`.
6. Include likely file scope, layer coverage, acceptance criteria, and behavior-level test sketches.
7. Validate graph coverage before returning.

## Task File Required Fields

- `id`
- `title`
- `type`
- `status`
- `blocked-by`
- `covers`
- `touches-layers`
- `files-likely-touched`

## RETURN

```yaml
phase: plan
status: Pending | blocked | failed | complete
artifacts:
  - plan.md
  - board.md
  - task.md
  - tests.md
summary: <brief user-facing summary>
open-ambiguity: []
```
