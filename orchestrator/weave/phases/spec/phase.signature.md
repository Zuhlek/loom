# Spec Grilling Agent — Signature

I/O signature between `/weave` and the Spec Grilling Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == spec` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched in a fresh `Task` session whose system prompt is the concatenation of `phase.md` and this signature (body first, then `\n\n---\n\n`, then signature).

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `seed.md` | `.loom/<project>/seed.md` | yes | Raw user input to clarify |
| `spec.md` | `.loom/<project>/spec.md` | on rerun | Prior run's output (starting point, not blank slate) |
| `decisions.md` | `.loom/<project>/decisions.md` | on rerun | Prior decision slots |
| `repo-context.md` | `.loom/<project>/repo-context.md` | on subsequent dispatch | Findings from the first-dispatch Explore subagent |
| `quality-review.md` | `.loom/<project>/quality-review.md` | when present | Quality Check findings to address |
| `principles.md` | `loom/principles.md` | yes | Engineering principles P1–P7 |
| `methods/grilling.md` | `loom/weave/phases/spec/methods/grilling.md` | yes | Six-rule question discipline, dispatch flow, slot conventions, revisit mechanic |
| `methods/categories.md` | `loom/weave/phases/spec/methods/categories.md` | yes | Per-category briefing templates and validation |
| `methods/stories.md` | `loom/weave/phases/spec/methods/stories.md` | yes | User story format, EARS acceptance-criteria patterns, marker shape, IDs, status |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

### State preconditions

- `pipeline.md.Current phase` is `spec`.
- `seed.md` exists in the workspace.

## Returns

### Return block

The Spec agent returns a single fenced YAML block tagged `RETURN` conforming to the schema below. The orchestrator extracts this block and runs a silent schema-compliance check; on mismatch it re-dispatches per `methods/recovery.md`.

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

Success criteria: `status: complete` in RETURN AND Design phase can proceed without redefining intent (stop rules in `methods/grilling.md` §7).

### Writes

#### `spec.md`

- Path: `.loom/<project>/spec.md`.
- Must exist.
- Must have front matter with `project` and `created`.
- Must contain the following sections, in this order:
  - What we're building
  - Users and value
  - Scope
  - Out of scope
  - User stories
  - Constraints
  - Open ambiguity
- Each story under `## User stories` MUST conform to the `loom:story` marker shape and EARS acceptance-criteria patterns specified in `methods/stories.md`.
- Universal acceptance conditions (envelope invariants that don't fit a specific user-action-shaped story) live under `## Constraints`, not as a separate Acceptance Boundaries section.
- Must make remaining ambiguity explicit under `## Open ambiguity` or state none.

#### `decisions.md`

- Path: `.loom/<project>/decisions.md`.
- Required after the first branching question.
- Every `loom:question` marker has a matching `loom:answer-slot`.
- Question categories are named categories only (see `methods/categories.md`).
- Active decisions have answered slots or are explicitly deferred.

#### `repo-context.md`

- Path: `.loom/<project>/repo-context.md`.
- Written on first dispatch only by the Explore subagent's findings.
- Subsequent dispatches read this file instead of re-exploring.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated (relay question for the user) | Surface the question; write answer back on next dispatch |
| `failed` | Quality Check returned `findings` and rerun did not resolve them | Surface to user; offer rerun |
