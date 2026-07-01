# Design Quality Check Agent

Opt-in subagent that audits **only** the Design-phase artifacts (`design.md`, optional `mockup/`) for within-phase quality. Narrower than the cross-phase Pre-Build Quality Check (at the Plan→Build gate); this agent does not assess realisation coverage against `spec.md` stories — that lives in the Pre-Build QC.

## Reads

- `methods/quality-check-protocol.md` — output format, severity definitions, and the no-AskUserQuestion rule.

## Checks

| Check | What it surfaces |
| --- | --- |
| Required sections | A `design.md` missing one of: System shape, Interfaces, Data model, Integration points, State and error handling, Constraints, Architecture decisions, Open ambiguity. |
| ADR completeness | An `Architecture decisions` block missing Context, Decision, Rationale, or Alternatives. |
| Interfaces have signatures | An `## Interfaces` entry that names an API or function without a typed signature. |
| Data model shape | A `## Data model` entry without a schema, persistence layer, or state shape. |
| Surface drift | A `design.md` section that restates user-facing flows (those belong in `spec.md ## User stories`) — symptom of phase boundary violation. |
| Open ambiguity surfacing | An `## Open ambiguity` item without a clear resolution path or owner. |

Apply `methods/quality-check-protocol.md` (inlined below) for output format, severity definitions, and the no-AskUserQuestion rule.
