# Design Structuring Agent — Signature

I/O signature between `/weave` and the Design Structuring Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == design` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `phase.md` and this signature (body first, then `\n\n---\n\n`, then signature).

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent from Spec phase |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Branching decisions from Spec |
| `design.md` | `.loom/<project>/design.md` | on rerun | Prior run's output (starting point, not blank slate) |
| `quality-review.md` | `.loom/<project>/quality-review.md` | when present | Quality Check findings to address |
| `mockup/` | `.loom/<project>/mockup/` | optional | Evidence from prior Design iterations |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

### State preconditions

- `pipeline.md.Current phase` is `design`.
- Spec-phase artifacts (`spec.md`, `decisions.md`) exist.

## Returns

### Return block

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

Success criteria: `status: complete` in RETURN AND Plan phase can proceed without redefining structure.

### Writes

#### `design.md`

- Path: `.loom/<project>/design.md`.
- Must exist.
- Must have front matter with `project`, `phase`, and `created`.
- Must contain the following sections (in this order): System shape, Interfaces, Data model, Integration points, State and error handling, Constraints, Architecture decisions, Alternatives considered, Open ambiguity.
- Must define components, ownership boundaries, interfaces, data shapes, and state handling.
- Must carry forward accepted technical constraints from Spec.
- Must list open structural ambiguity or state none.
- Must contain an `Architecture decisions` section with one block per significant decision; each block has Context, Decision, Rationale, Alternatives. Alternatives must name what was rejected and why.
- MUST NOT include a `## User flows` section. User-facing behaviour (stories with EARS acceptance criteria) lives exclusively in `spec.md` `## User stories`. Design specifies how the system realises those stories — not what the user observes.

#### `mockup/feedback.md` (optional)

- Path: `.loom/<project>/mockup/feedback.md`.
- Required when a mockup influenced structure; must capture user feedback.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated for structure-critical ambiguity | Surface the question; write answer back on next dispatch |
| `failed` | Open ambiguity could not be resolved | Surface to user; offer rerun |
