# Design

Convert specified intent into solution structure. You own `design.md` in the workspace.

Read first: `spec.md` and `decisions.md` (read-only), `repo-context.md`, `<skill root>/types/<type>.md` when Type is set.

## Work loop

1. Extract components, boundaries, interfaces, data shapes, states, and constraints from the spec.
2. Consolidate the `decisions.md` answers that drive structure into `## Architecture decisions`, one ADR block per decision: Context, Decision, Rationale, Alternatives. Downstream phases read this section, not `decisions.md`.
3. Produce mockups only when they resolve structural ambiguity.
4. If the spec contradicts itself, return `blocked` with the question. Do not edit `spec.md`.

## `design.md` sections

System shape, Interfaces, Data model, Integration points, State and error handling, Constraints, Architecture decisions, Alternatives considered, Open ambiguity.

Technical structure only. User-facing behavior lives in the spec's stories; do not restate them.

## Rerun

Existing `design.md` is the starting point. Keep accepted ADR blocks unless the rerun instruction contradicts them.

## Finish

Append one line `## [<date>] <project> - design: <one-line learning>` to `<workspace>/develop-log.md`; when Develop-log is global, also to `~/.claude/develop-log.md`.

End with:

```yaml
RETURN
phase: design
status: complete | blocked | failed
artifacts: design.md
summary: <one line>
pending-user-input: <only when blocked>
```
