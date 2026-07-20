# Work Graph Agent — Signature

I/O signature between `/weave` and the Work Graph Agent.

## Trigger

**Caller:** `/weave` orchestrator.

**Invocation condition:** `pipeline.md.Current phase == plan` AND `Phase status ∈ {Pending, blocked, failed}`. Dispatched per the two-band contract in `orchestrator/weave/SKILL.md § Dispatch concatenation`; resolve `<project>` / `<phase>` / `<task>` placeholders by reading the `<system-reminder>` tail block.

## Params

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Spec-phase decisions |
| `design.md` | `.loom/<project>/design.md` | yes | Solution structure |
| Evidence artifacts | `.loom/<project>/mockup/` etc. | optional | Design-phase evidence |
| `plan.md` + `board.md` + `tests.md` + `tasks/T-*.md` | `.loom/<project>/` | on rerun | Prior run's outputs (starting point, not blank slate) |
| `quality-review.md` | `.loom/<project>/quality-review.md` | when present | Quality Check findings to address |
| `review.md` | `.loom/<project>/review.md` | fix round only | Review findings source when the dynamic tail carries `Findings source: review.md` (see `phase.md § Refine scope` › Fix-round refine) |
| `type-guidance.md` | `.loom/<project>/type-guidance.md` | when typed | Domain guidance (materialized at project creation from the active `types/<type>.md`) |

### State preconditions

- `pipeline.md.Current phase` is `plan`.
- Spec and Design phase artifacts exist.

## Returns

### RETURN block

```yaml
type: object
required: [phase, status, artifacts, summary, open-ambiguity]
properties:
  phase:
    enum: [plan]
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
  total-tasks:
    type: integer
  afk-count:
    type: integer
  hitl-count:
    type: integer
```

Success criteria: `status: complete` in RETURN AND the Build phase agent can pick ready tasks from `board.md` without ambiguity.

### Writes

#### `plan.md`

- Path: `.loom/<project>/plan.md`.
- Must exist.
- Must contain the four required sections per `phase.md § plan.md contract`, in order: `## Approach & sequencing`, `## Plan decisions`, `## Risks`, `## Verification environment`.
- `## Plan decisions` carries one `### <Decision title>` block (Context / Decision / Rationale / Alternatives) per significant plan-level decision; the verification-environment choice, the mutation yes/no, and every `HITL` designation are mandatory blocks at every depth.
- `## Verification environment` names the harness Build will use to execute the acceptance gates declared in `tests.md`.

#### `board.md`

- Path: `.loom/<project>/board.md`.
- Must contain exactly four `## ` headers, in order: `Backlog`, `In Progress`, `Review`, `Done`.
- Every task in `tasks/T-*.md` must appear under exactly one column.
- At Plan-time, every task must be in `Backlog`.
- Each non-empty column has one card per line matching `^-\s+(?:\[[^\]]+\]\s+)?T-\d+\s+.+`.
- Empty columns carry the literal `- (none)` placeholder.
- Tasks with `blocked-by` entries display `(blocked by T-XXX, T-YYY)` in the card title.
- `HITL` tasks display `[HITL]` immediately after the ID.
- Stale tasks (after a Plan rerun) display `[stale]` immediately after the ID and live in `Backlog`.

#### `tests.md`

- Path: `.loom/<project>/tests.md`.
- Contains phase-wide verification strategy.
- Declares `**Mutation Testing:** yes` or `no` at the top of the file.
- Smoke and mutation gates are explicit.

#### `tasks/T-*.md`

- Path: `.loom/<project>/tasks/T-NNN.md`.
- At least one task file required.
- Each carries the required frontmatter fields: `id`, `title`, `type`, `status`, `blocked-by`, `satisfies-stories`, `touches-layers`, `files-likely-touched`.
- `blocked-by` references existing tasks only.
- Task IDs are stable `T-NNN`.
- The graph is acyclic.
- Every active `US-NNN` story from `spec.md` `## User stories` is covered by at least one task. Coverage is asserted by the task's `satisfies-stories` frontmatter field.
- Task titles describe observable behavior.
- Single-layer tasks require explicit justification.
- Each task contains a behavior-level test sketch.

#### `ticket.md` (optional)

- Path: `.loom/<project>/ticket.md`.

### Deterministic validation

A Plan return with `status: complete` is additionally validated by the `SubagentStop` hook (`hooks/validate-subagent-output.py`) — always-on, zero-token, not opt-in:

- Every `tasks/T-NNN.md` carries the required frontmatter fields (`id`, `title`, `type` ∈ {AFK, HITL}, `status`, `blocked-by`, `satisfies-stories` with ≥1 entry, `touches-layers`, `files-likely-touched`).
- Every `blocked-by` reference resolves to an existing task; the graph is acyclic.
- Every `status=active` `US-NNN` story in `spec.md ## User stories` appears in at least one task's `satisfies-stories`.
- `board.md` has exactly the four columns in order and every task file appears on exactly one card.
- `plan.md` contains the four required sections; `tests.md` declares `**Mutation Testing:** yes|no`.

A violation blocks the return with the violation list as the reason. The pre-Build Quality Check no longer re-checks these mechanical invariants — it audits judgment-level quality only.

## Throws

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated for plan-critical ambiguity, OR the feasibility pre-check failed (see `phase.md § Work Loop` step 2 — `plan.md ## Infeasibility note` names the owning phase) | Surface the question or the infeasibility; for infeasibility recommend `Go back to <owning phase>` at the gate |
| `failed` | Graph coverage validation failed | Surface to user; offer rerun |

### Rerun rules

- Existing `T-NNN` IDs are preserved across reruns.
- Tasks in `In Progress`, `Review`, `Done` stay in column unless explicitly invalidated.
- Invalidated tasks return to `Backlog` with a `[stale]` tag; fix-round tasks carry a `[fix]` tag.
