---
name: tune
description: Give feedback, curate develop-log learnings, and analyze session transcripts for insights.
user-invocable: true
argument-hint: [<feedback> | review | insights]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion
---

# Tune Skill

The tune system's meta-layer. Accepts feedback, curates develop-log entries into skill improvements, and analyzes session transcripts for blind spots.

## Pipeline

```
user feedback ──→ develop-log ←── transcript insights
                      │
                  /tune review
                      │
                SKILL.md + type changes
```

- **Develop-log** captures what Claude noticed (self-reported) and what the user flagged (via `/tune`)
- **Transcripts** capture what actually happened — user corrections, friction, violations never logged
- **`/tune review`** is the single gatekeeper for SKILL.md and type file changes
- Cross-skill patterns (idea→build handoff, type confusion, post-build drift) only emerge when reviewing both sources

## Arguments

- `/tune <text>` — interpret and log feedback to develop-log
- `/tune review` — curate develop-log → propose SKILL.md/type changes
- `/tune insights` — analyze transcripts → write findings to develop-log
- `/tune` — list recent unapplied develop-log entries (quick status check)

---

## Mode: Feedback (`/tune <text>`)

Interpret the user's feedback and write a structured develop-log entry.

1. Read `~/.claude/skills/develop-log.md` to understand current entries and format
2. Interpret the feedback — identify which skill, project, and type it relates to
3. Only ask clarifying questions when the feedback is genuinely unclear or unspecific
4. Write a structured entry to `~/.claude/skills/develop-log.md`:

```markdown
## [date] — <project-name or "general"> — Feedback
**Skill:** user-feedback
**About:** [idea/build/tune/cross-skill/general]
**Observation:** [the user's feedback, interpreted and structured]
**Proposed change:** [if the feedback implies a specific change — or "none, observation only"]
```

5. Confirm what was logged (one line)

### Rules for feedback mode

- **Don't over-interpret.** If the user says "the triage was wrong", log that — don't invent a solution.
- **Preserve the user's words.** Quote key phrases.
- **Infer context when obvious.** If a project was just built, reference it. If a skill was just used, name it.
- **Ask only when genuinely stuck.** "The thing was bad" → ask. "Triage should have been quick not standard" → log directly.

---

## Mode: Review (`/tune review`)

Curate the develop-log into skill and type improvements. This is the ONLY path to SKILL.md or type file changes.

1. Read `~/.claude/skills/develop-log.md`
2. Read all SKILL.md files: `~/.claude/skills/weave/SKILL.md`, `~/.claude/skills/tune/SKILL.md`
3. Read all type files in `~/.claude/skills/types/`
4. Group unapplied entries by theme. Identify patterns (2+ occurrences of same issue)
5. For each pattern, draft a specific change:
   - **SKILL.md edits** — process improvements for idea, build, or tune
   - **Type file additions** — domain-specific knowledge for a type
6. Present all proposed changes via AskUserQuestion — grouped by target file
7. Apply approved changes
8. Mark log entries `[APPLIED]`. Prune: delete `[APPLIED]` entries older than the most recent 5.

---

## Mode: Insights (`/tune insights`)

Analyze session transcripts for patterns that self-reporting missed. Outputs to develop-log only — never proposes SKILL.md changes directly.

### Finding Sessions

1. Find JSONL transcript files:
   ```
   Grep pattern="/weave|/tune" path="~/.claude/projects/" glob="*.jsonl" output_mode="files_with_matches"
   ```
2. For each matching file, count tune keyword density to rank sessions
3. Focus on the top 5-10 sessions by keyword count

### Analyzing Sessions

For each session, use a Task subagent to extract:

1. **Skill invocations**: Every `/idea`, `/build`, and `/tune` call — did it follow correct phases?
2. **User corrections**: Messages containing "stop", "revert", "why did you", "no", "wrong", request interruptions
3. **Process violations**: Skipped phases, edited SKILL.md directly, type confusion, premature implementation
4. **Handoff quality**: Did task.md from `/idea` give `/build` enough context? Did build deviate from plan?
5. **Post-build drift**: Did significant changes happen after `.build-phase = built`?
6. **Verification gaps**: Were UI changes tested in the browser? Were builds verified?

### Writing Findings

For each finding, write a develop-log entry:

```markdown
## [date] — (audit-recovered) — <finding summary>
**Skill:** tune-insights
**Sessions:** [session IDs]
**Evidence:** [user quote or behavior description]
**Proposed change:** [specific edit suggestion — or "observation only"]
```

These entries will be picked up by `/tune review` in a future curation pass.

### Summary

1. Write a brief summary of what was analyzed and what was found
2. Compare transcript findings against develop-log entries — what was logged vs what actually happened?
3. Note any recurring patterns that have been addressed before but keep reappearing

---

## Mode: Status (`/tune` no args)

1. Read `~/.claude/skills/develop-log.md`
2. List unapplied entries (those without `[APPLIED]` marker)
3. Group by skill/theme
4. Show count and most recent entry per group
5. Suggest `/tune review` if patterns are accumulating

---

## Develop-Log Format

The unified develop-log lives at `~/.claude/skills/develop-log.md`. All entries from `/idea`, `/build`, and `/tune` go here.

### Weave phase entries

```markdown
## [date] — <project-name> — Phase: <phase>
**Skill:** weave
**Track:** [spec/design/plan/build/review]
**Type:** [type or "uncategorized"]
**Worked well:** [what went correctly]
**Problems:** [what was unclear — be specific]
**Proposed change:** [exact edit or "none"]
```

### Weave task entries

```markdown
## [date] — <project-name> — Task: <task-number>
**Skill:** weave
**Type:** [type or "uncategorized"]
**What worked:** [brief]
**What didn't:** [brief]
**Type knowledge:** [anything for types/<type>.md — or "none"]
```

### Process entries

```markdown
## [date] — <project-name> — Process
**Skill:** [weave/tune/cross-skill]
**Type:** process
**What worked:** [what the skill handled correctly]
**Problems:** [what was unclear in SKILL.md]
**Proposed change:** [exact edit or "none"]
```

### User feedback entries

```markdown
## [date] — <project-name or "general"> — Feedback
**Skill:** user-feedback
**About:** [idea/build/tune/cross-skill/general]
**Observation:** [the user's feedback, interpreted and structured]
**Proposed change:** [if the feedback implies a specific change — or "none, observation only"]
```

### Audit-recovered entries

```markdown
## [date] — (audit-recovered) — <finding summary>
**Skill:** tune-insights
**Sessions:** [session IDs]
**Evidence:** [user quote or behavior description]
**Proposed change:** [specific edit suggestion — or "observation only"]
```

## Type File Governance

Type files (`~/.claude/skills/types/*.md`) are shared between idea and build. They are ONLY modified during `/tune review` — never directly during project sessions. This is the single point of curation.

## Rules

- **Evidence over opinion.** Every proposed change must cite a develop-log entry or transcript finding.
- **2+ occurrences for SKILL.md changes.** One-off issues stay in the log. Patterns become rules.
- **Don't over-legislate.** If a rule would only prevent one past issue and adds complexity, skip it. Note it and move on.
- **Type files are team knowledge.** Keep them concise — actionable patterns, not documentation.
- **Never edit SKILL.md without user approval.** Always propose via AskUserQuestion first.
- **Transcript analysis is expensive.** Only analyze the most tune-heavy sessions. Use keyword density to triage.
- **Feedback mode is fast.** Don't turn a quick note into a conversation. Log and confirm.
