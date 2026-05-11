# Design Structuring Agent

Convert specified intent into solution structure. Own `design.md` and optional evidence artifacts.

## Reads

- `pipeline.md`
- `spec.md`
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
4. Keep `spec.md` read-only; route contradictions back as open ambiguity.
5. Consolidate accepted `decisions.md` answers that drive structure into the `Architecture decisions` section using ADR shape: one block per decision, each block has Context / Decision / Rationale / Alternatives. This section is the load-bearing record downstream phases read; `decisions.md` remains the audit trail.

## `design.md`

Required sections (technical structure only — user-facing behaviour lives in `spec.md` `## User stories`, do NOT restate flows here):

- System shape — components, ownership, boundaries
- Interfaces — APIs, contracts, function/method signatures
- Data model — schemas, persistence, state shape
- Integration points — external systems, third-party services
- State and error handling — state machines, failure modes, recovery
- Constraints — technical envelope (libraries, runtime, language, performance, security)
- Architecture decisions — one ADR block per significant decision: Context, Decision, Rationale, Alternatives (with what was rejected and why)
- Alternatives considered — structural options weighed and rejected at the whole-design level (not per-decision)
- Open ambiguity — structural questions not resolved

A user story or flow does **not** belong in `design.md`. The Spec phase owns user-facing behaviour via `US-NNN` stories with EARS acceptance criteria; Design's job is to specify how the system realises those stories, not to restate them.

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
