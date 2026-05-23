# Develop-log adapter

`/weave` populates the develop-log curated by `/tune`. `/tune` owns the contract; `/weave` complies.

- **Where:** `~/.claude/skills/develop-log.md` (single global file across all projects and skills).
- **What:** the entry shapes defined in `orchestrator/tune/SKILL.md` › "Develop-Log Format". Two apply to `/weave`:
  - **Phase entry** — appended at every phase boundary (spec, design, plan, build, review).
  - **Task entry** — appended once per Build task as part of the per-task done procedure.
- **How:** append-only. Never edit existing entries. `/tune review` is the sole mutator.
