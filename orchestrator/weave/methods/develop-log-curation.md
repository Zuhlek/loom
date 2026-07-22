# Develop-Log Curation

Human-gated pass that turns `orchestrator/develop-log.md` entries into phase-file and type-file improvements. Run on request ("curate the develop log"), not by the orchestrator — it is a maintenance activity outside the lifecycle. Without this pass the log only accumulates; with it, the log is the mechanism by which loom improves itself.

## Evidence rules

- **Evidence over opinion.** Every proposed change cites the develop-log entries that motivate it.
- **2+ occurrences for a phase-file or method-file change.** A single entry proposes nothing structural — it waits for corroboration. One occurrence suffices only for factual corrections (a documented command that doesn't run, a path that doesn't exist).
- **Don't over-legislate.** Prefer deleting a rule that caused confusion over adding a rule that patches it. A phase file that grows on every curation pass is a smell.
- **Never edit a phase file, signature, or method file without explicit user approval** of the specific diff — propose via `AskUserQuestion` or a summarized diff, apply only what the user confirms.

## Procedure

1. Read `orchestrator/develop-log.md` end to end. Group entries by candidate target (`phase-file:` / `type-file:` / `process`).
2. For each target with 2+ corroborating entries, draft the smallest edit that addresses the recurrence. State the cited entries.
3. Surface all drafts to the user for approval; apply only approved edits.
4. Mark consumed entries with a leading `[APPLIED <date>]` tag (or `[REJECTED <date>]` with a one-line reason). Never delete unconsumed entries.
5. Prune: `[APPLIED]` / `[REJECTED]` entries older than the most recent 5 of each kind are deleted — the applied change is the durable record, not the log line.

## Entry shape (what Review appends)

```markdown
## <date> — <project> — Learning
**Target:** phase-file: weave/phases/<phase>/phase.md | type-file: <type> | process
**Lesson:** <the distilled insight — a fact about how the lifecycle behaved, not a pointer to where it happened>
**Evidence:** <one line: what happened in this run>
```
