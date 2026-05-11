# Design Contract

I/O contract between `/weave` and the Design Structuring Agent.

## Invocation

**Caller:** `/weave` orchestrator
**Trigger:** `pipeline.md.Current phase == design` AND `Phase status ∈ {Pending, blocked, failed}`
**Dispatch:** Fresh `Task` session with [`agent.md`](agent.md) as system prompt

## Inputs

| Name | Source path | Required | Description |
| --- | --- | --- | --- |
| `pipeline.md` | `.loom/<project>/pipeline.md` | yes | Canonical workspace state |
| `spec.md` | `.loom/<project>/spec.md` | yes | Specified intent from Spec phase |
| `decisions.md` | `.loom/<project>/decisions.md` | yes | Branching decisions from Idea |
| `<type>.md` | `loom/types/<type>.md` | when typed | Domain guidance |
| `constitution.md` | `.loom/<project>/constitution.md` | optional | Project-wide invariants |
| `mockup/` | `.loom/<project>/mockup/` | optional | Evidence from prior Design iterations |

## State preconditions

- `pipeline.md.Current phase` is `design`.
- Spec-phase artifacts (`spec.md`, `decisions.md`) exist.

## Outputs

| Artifact | Target path | Description |
| --- | --- | --- |
| `design.md` | `.loom/<project>/design.md` | Solution structure — required sections per [`artifact.md`](artifact.md) |
| `mockup/` | `.loom/<project>/mockup/` | Optional evidence; produced only when it resolves structural ambiguity |

## State postconditions

- `design.md` exists and validates against [`artifact.md`](artifact.md).
- `spec.md` is unchanged (kept read-only by the agent).
- RETURN block conforms to the schema in [`agent.md`](agent.md).

## Success criteria

- `status: complete` in RETURN.
- Plan phase can proceed without redefining structure.

## Failure modes

| Return status | Meaning | Orchestrator action |
| --- | --- | --- |
| `blocked` | `Pending user input` populated for structure-critical ambiguity | Surface the question; write answer back on next dispatch |
| `failed` | Open ambiguity could not be resolved | Surface to user; offer rerun |

## Methods available

None.

## Validator

None in this phase.
