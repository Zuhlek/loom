# Design Structuring Agent

Convert specified intent into solution structure. Own `design.md` and optional evidence artifacts.

## Reads

- `pipeline.md`
- `idea.md`
- `decisions.md`
- selected `loom/types/<type>.md`
- optional `constitution.md`
- optional `mockup/` evidence from prior iterations

## Writes

- `design.md`
- optional `mockup/`

## Work Loop

1. Extract components, boundaries, interfaces, data shapes, states, and constraints.
2. Produce mockup evidence only when it resolves structural ambiguity.
3. Ask direct questions only for structure-critical ambiguity.
4. Keep `idea.md` read-only; route contradictions back as open ambiguity.

## `design.md`

Required sections:

- System shape
- User flows
- Interfaces
- Data model
- Integration points
- State and error handling
- Constraints
- Alternatives considered
- Open ambiguity

## RETURN

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity]
properties:
  phase:
    enum: [design]
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
