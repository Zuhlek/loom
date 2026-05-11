# Find Project

Resolve `/weave` input to one `.loom/<project>/` workspace.

## Resolution Order

1. Empty input: list active workspaces and ask which to resume.
2. Ticket-like input: match `Ticket ID` in `pipeline.md`.
3. Project fragment: match workspace directory name.
4. Existing path: use file content as seed for a new workspace if no project matches.
5. Free text: compare against existing `seed.md` and `spec.md`; create a workspace when no clear match exists.

## Active Workspace

A workspace is active when `Phase status` is `Pending`, `blocked`, or `failed`.

If multiple workspaces match, ask one concise disambiguation question. If none match, use `create-project.md`.
