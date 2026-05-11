# Design Artifact Contract

## `design.md`

- Must exist.
- Must have front matter with `project`, `phase`, and `created`.
- Must contain the following sections (in this order): System shape, Interfaces, Data model, Integration points, State and error handling, Constraints, Alternatives considered, Open ambiguity.
- Must define components, ownership boundaries, interfaces, data shapes, and state handling.
- Must carry forward accepted technical constraints from Spec.
- Must list open structural ambiguity or state none.
- MUST NOT include a `## User flows` section. User-facing behaviour (stories with EARS acceptance criteria) lives exclusively in `spec.md` `## User stories`. Design specifies how the system realises those stories — not what the user observes.

## Optional Evidence

- `mockup/feedback.md` must capture user feedback when a mockup influenced structure.
