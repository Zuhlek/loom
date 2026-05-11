# Create Project

Create `.loom/<project>/` from a seed.

## Steps

1. Derive a kebab-case project name.
2. Extract optional ticket ID and type hint from the seed.
3. Create core files: `pipeline.md`, `seed.md`, `events.jsonl`, `artifacts.json`.
4. Copy `loom/templates/constitution.md` into the workspace when the project is expected to touch code.
5. Set current phase to `idea`, status to `Pending`, resume point to `idea:foundation`.
6. Append `project-created` to `events.jsonl`.

Use `loom/lib/pipeline-parser.py init` for the initial state when available.
