# Spec Artifact Contract

## `spec.md`

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
- Each story under `## User stories` MUST conform to the `loom:story` marker shape and EARS acceptance-criteria patterns specified in [`methods/stories.md`](methods/stories.md).
- Universal acceptance conditions (envelope invariants that don't fit a specific user-action-shaped story) live under `## Constraints`, not as a separate Acceptance Boundaries section.
- Must make remaining ambiguity explicit under `## Open ambiguity` or state none.

## `decisions.md`

- Required after the first branching question.
- Every `loom:question` marker has a matching `loom:answer-slot`.
- Question categories are named categories only (see [`methods/categories.md`](methods/categories.md)).
- Active decisions have answered slots or are explicitly deferred.
