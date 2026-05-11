# Review Artifact Contract

## `review.md`

- Must state pass, fail, or accepted risk.
- Must reference intent, design, plan, and build evidence.
- Must list blockers and major issues or state none.
- Must route unresolved work to an owner phase.

## `feedback.md`

- Must capture user approval, requested change, rejection, or risk acceptance when asked.

## `develop-log.md`

- Must record process observations worth later curation.
- Learning entries must use the heading `## YYYY-MM-DD - <project> - <topic>`.

## Global learning-shard appends (dual-write)

Review writes learning observations to two surfaces. Both are required.

| Stream | Path | Purpose |
| --- | --- | --- |
| Project-local | `.loom/<project>/develop-log.md` | Raw observations for this project |
| Global shard | `loom/log/{audit,build,feedback,ideate}.md` | Curation source for `/tune review` |

For every learning observation written to `develop-log.md`, a matching `## YYYY-MM-DD - <project> - <topic>` entry must exist in the appropriate `loom/log/<shard>.md`:

| Topic | Shard |
| --- | --- |
| Idea / Design / Plan process notes | `ideate.md` |
| Build / Smoke / Mutation process notes | `build.md` |
| Cross-phase audit observations | `audit.md` |
| User-pushback or feedback patterns the user surfaced | `feedback.md` |

If the user opts into a Quality Check on Review, the check verifies that every project-local learning entry has a matching global-shard entry. A missing append is a `major` finding.

Review-cycle findings (the `review.md` content itself) stay project-local — they are not duplicated to the global shards.
