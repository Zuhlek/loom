# Idea Contract

I/O contract between `/weave` and the Idea Grilling Agent.

## Invocation

**Caller:** `/weave` orchestrator
**Trigger:** `pipeline.md.Current phase == idea` AND `Phase status ∈ {Pending, blocked, failed}`
**Dispatch:** Fresh `Task` session with [`agent.md`](agent.md) as system prompt

## Inputs

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `seed.md` | `.loom/<project>/seed.md` | yes | Raw user input to clarify |
| `idea.md` | `.loom/<project>/idea.md` | on rerun | Prior run's output (starting point, not blank slate) |
| `decisions.md` | `.loom/<project>/decisions.md` | on rerun | Prior decision slots |
| `quality-review.md` | `.loom/<project>/quality-review.md` | when present | Validator findings to address |
| `principles.md` | `loom/principles.md` | yes | Engineering principles P1–P7 |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |

## State preconditions

- `pipeline.md.Current phase` is `idea`.
- `seed.md` exists in the workspace.

## Outputs

| Artifact | Target path | Description |
| --- | --- | --- |
| `idea.md` | `.loom/<project>/idea.md` | Specified intent — required sections per [`artifact.md`](artifact.md) |
| `decisions.md` | `.loom/<project>/decisions.md` | Branching decisions with `loom:question` / `loom:answer-slot` markers |

## State postconditions

- `idea.md` and `decisions.md` exist and validate against [`artifact.md`](artifact.md).
- RETURN block conforms to the schema in [`agent.md`](agent.md).

## Success criteria

- `status: complete` in RETURN.
- Design phase can proceed without redefining intent (stop rules in [`methods/grilling.md`](methods/grilling.md) §7).

## Failure modes

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated (relay question for the user) | Surface the question; write answer back on next dispatch |
| `failed` | Validator returned `findings` and rerun did not resolve them | Surface to user; offer rerun |

## Methods available

- [`methods/grilling.md`](methods/grilling.md) — six-rule question discipline, dispatch flow, slot conventions, revisit mechanic
- [`methods/categories.md`](methods/categories.md) — per-category briefing templates and validation

## Validator

- [`validator.md`](validator.md) — opt-in quality check. Orchestrator dispatches in a separate Task only when the user picks `Run quality check`.
