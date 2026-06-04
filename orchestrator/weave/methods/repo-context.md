# Repo context

Optional, user-maintained, hand-curated context file. Loom's Spec phase reads it if present; nothing else writes to it.

- **Where:** `.loom/<project>/repo-context.md`.
- **Owner:** the user. The orchestrator and every phase agent treat it as read-only.
- **Shape:** plain markdown, < 200 lines. Anything longer drifts in practice and stops being read in full.
- **What goes in it:** the things grep cannot tell the agent — *why* the codebase is structured the way it is, naming conventions and idioms the team enforces, where load-bearing logic lives, integration points, and any "if you're touching X, also consider Y" cross-cutting concerns.
- **What does NOT go in it:** restatements of file contents, lists of files (grep does that), per-task notes (those belong in `tasks/T-NNN.md`), or anything that changes between projects against the same repo (that belongs in `seed.md` for the project).

## When the Spec agent reads it

Foundation grilling. Spec reads `repo-context.md` before generating Foundation questions and treats every fact it states as established — Foundation questions fill gaps the file does not cover. For repo facts the file does not address, Spec searches the repo directly with Read/Grep/Bash. Load the small hand-curated artifact eagerly; derive everything else lazily — there is no pre-computed digest.

## When to add or update

The user adds `repo-context.md` to a workspace when the seed touches an area where a Foundation question would otherwise burn turns asking about facts a human can state in two paragraphs. There is no schedule and no required update cadence; the file is a tool for keeping Foundation grilling productive, not a deliverable.
