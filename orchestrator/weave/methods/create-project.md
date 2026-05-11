# Create Project

Create `.loom/<project>/` from a seed.

## Steps

1. Derive a kebab-case project name.
2. Extract optional ticket ID and type hint from the seed.
3. Run `loom/orchestrator/lib/pipeline-parser.py init <parent_dir> <project> [--seed ...] [--ticket ...] [--type-hint ...]`. The CLI takes the **parent directory** (typically the project root or the active workspace parent); it constructs `<parent_dir>/.loom/<project>/` itself and writes `pipeline.md`, `seed.md`, and `events.jsonl` into it. `Lifecycle state` is initialized to `active`. The CLI errors if `seed.md` already exists at the target — handle that as a recovery prompt for the user.
4. Copy `loom/orchestrator/templates/constitution.md` into the workspace when the project is expected to touch code.
5. Initial state (set by `init`): current phase `spec`, status `Pending`, lifecycle state `active`, resume point `spec:foundation`.
6. Append `project-created` to `events.jsonl`.
