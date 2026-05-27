# Spec Grilling Agent — Signature

I/O signature between `/weave` and the Spec Grilling Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == spec` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`; resolve `<project>` / `<phase>` / `<task>` placeholders by reading the `<system-reminder>` tail block.

## Params

The `methods/*` rows below are skill-resident procedures: the orchestrator reads them from the listed source path and inlines them verbatim into the dispatch head (per the body's `## Reads`, see `orchestrator/weave/SKILL.md § Dispatch concatenation`). The subagent applies them from the inlined head — it does not disk-read them. The `.loom/...` artifact rows are workspace files the subagent reads from its cwd.

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `seed.md` | `.loom/<project>/seed.md` | yes | Raw user input to clarify |
| `spec.md` | `.loom/<project>/spec.md` | on rerun | Prior run's output (starting point, not blank slate) |
| `decisions.md` | `.loom/<project>/decisions.md` | on rerun | Prior decision slots |
| `repo-digest.md` | `.loom/.cache/repo-digest.md` | yes | Cross-fabric stable repo facts; reused across fabrics |
| `repo-digest.manifest.json` | `.loom/.cache/repo-digest.manifest.json` | yes | Versioning surface for the digest (`schema_version`, `git_head`, `tracked_files` sha256) |
| `repo-context.md` | `.loom/<project>/repo-context.md` | yes | Seed-relevant slice produced by `/weave`'s repo pre-flight |
| `quality-review.md` | `.loom/<project>/quality-review.md` | when present | Quality Check findings to address |
| `phases/spec/methods/grilling.md` | `orchestrator/weave/phases/spec/methods/grilling.md` | yes | Six-rule question discipline, dispatch flow, slot conventions, revisit mechanic |
| `phases/spec/methods/categories.md` | `orchestrator/weave/phases/spec/methods/categories.md` | yes | Per-category briefing templates and validation |
| `phases/spec/methods/stories.md` | `orchestrator/weave/phases/spec/methods/stories.md` | yes | User story format, EARS acceptance-criteria patterns, marker shape, IDs, status |
| `<type>.md` | `orchestrator/types/<type>.md` | when typed | Domain guidance |

### State preconditions

- `pipeline.md.Current phase` is `spec`.
- `seed.md` exists in the workspace.

## Returns

### Return block

The Spec agent returns a single fenced YAML block tagged `RETURN` conforming to the schema below. Schema enforcement runs as a `SubagentStop` hook (`hooks/validate-subagent-output.py`); malformed returns surface as visible hook blocks.

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

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated (relay question for the user) | Surface the question; write answer back on next dispatch |
| `failed` | Quality Check returned `findings` and rerun did not resolve them | Surface to user; offer rerun |
