# Create Project

Create `.loom/<project>/` from a seed.

## Steps

1. Derive a kebab-case project name.
2. **Overlap scan.** Before continuing, scan existing `.loom/*/spec.md` and `.loom/*/seed.md`. If any project's seed or "What we're building" section has substantial overlap (>0.4 token Jaccard) with the new seed, surface via `AskUserQuestion`: *"This looks similar to existing project `<name>` (seed: `<one-line>`). Continue that project, or create a new one?"* On "Continue existing", dispatch `find-project` for the existing name and exit `create-project` without creating a new workspace. Skip the scan when `.loom/` has no projects yet.
3. Extract optional ticket ID and type hint from the seed.
4. Run `loom/orchestrator/lib/pipeline-parser.py init <parent_dir> <project> [--seed ...] [--ticket ...] [--type-hint ...]`. The CLI takes the **parent directory** (typically the project root or the active workspace parent); it constructs `<parent_dir>/.loom/<project>/` itself and writes `pipeline.md`, `seed.md`, and `events.jsonl` into it. `Lifecycle state` is initialized to `active`. The CLI errors if `seed.md` already exists at the target — handle that as a recovery prompt for the user.
5. Copy `loom/orchestrator/templates/constitution.md` into the workspace when the project is expected to touch code.
6. Initial state (set by `init`): current phase `spec`, status `Pending`, lifecycle state `active`, resume point `spec:foundation`.
7. Append `project-created` to `events.jsonl`.
