# Repo context

Optional, user-maintained, hand-curated context file. Loom's Spec phase reads it if present; nothing else writes to it.

- **Where:** `.loom/<project>/repo-context.md`.
- **Owner:** the user. The orchestrator and every phase agent treat it as read-only.
- **Shape:** plain markdown, < 200 lines. Anything longer drifts in practice and stops being read in full.
- **What goes in it:** the things grep cannot tell the agent — *why* the codebase is structured the way it is, naming conventions and idioms the team enforces, where load-bearing logic lives, integration points, and any "if you're touching X, also consider Y" cross-cutting concerns.
- **What does NOT go in it:** restatements of file contents, lists of files (grep does that), per-task notes (those belong in `tasks/T-NNN.md`), or anything that changes between projects against the same repo (that belongs in `seed.md` for the project).

## When the Spec agent reads it

Foundation grilling. Spec reads `repo-context.md` before generating Foundation questions and treats every fact it states as established — Foundation questions fill gaps the file does not cover. For repo facts the file does not address, Spec uses its own Read / Grep / Bash tools inline (agentic search) rather than relying on a pre-computed digest. This is the progressive-disclosure pattern: load the small hand-curated artifact eagerly, derive everything else lazily.

## Why no auto-generated digest

An earlier version of Loom auto-generated a `repo-digest.md` and a sha256 manifest gating its cache. That pattern was removed because: (1) hashing tracked files detects file edits but not architectural drift (new modules, renamed files, refactors that move logic between files all validate as cache-hits while being semantically stale); (2) the eager mandatory pre-flight contradicts the progressive-disclosure pattern that has become standard across Claude Code, Aider, Cursor, Cline, and SWE-agent; (3) the Spec agent already does agentic search competently when it needs a repo fact, on fresher signal than any cache. The simpler contract — one optional hand-curated file plus agentic search — covers the same ground at lower cost and lower staleness risk.

## When to add or update

The user adds `repo-context.md` to a workspace when the seed touches an area where a Foundation question would otherwise burn turns asking about facts a human can state in two paragraphs. There is no schedule and no required update cadence; the file is a tool for keeping Foundation grilling productive, not a deliverable.
