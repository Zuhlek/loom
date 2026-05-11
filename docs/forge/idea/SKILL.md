---
name: idea
description: Turns a rough idea into a structured project with plan and tasks. Captures user intent before implementation begins.
user-invocable: true
argument-hint: [ticket-id] [type] [project-name | forge] [description...]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion, TaskCreate, TaskUpdate, TaskGet, TaskList
---

# Idea Skill

Turn a rough idea into a specified project before any code is written.

## Arguments

- `/idea CSD-789 create a date picker` → new project with ticket prefix (→ `.forge/CSD-789-date-picker/`)
- `/idea create a date picker` → new project, will ask for ticket ID
- `/idea CSD-789-date-picker` → continue existing project where it left off
- `/idea forge` → redirects to `/forge review` (unified forge skill)
- `/idea` → list all `.forge/*/` projects with their current `.phase`
- `/idea CSD-789 cloud-infra setup auth service` → ticket + type + description
- `/idea cloud-infra setup auth service` → type=cloud-infra, will ask for ticket ID

### Ticket ID

A ticket ID (format: uppercase letters + hyphen + digits, e.g. `CSD-789`) is used as a prefix in the project directory name. If the first argument matches the pattern `[A-Z]+-\d+`, it is parsed as the ticket ID and removed from further argument processing.

**If no ticket ID is provided**, ask the user via AskUserQuestion before creating the project directory:
> "What's the ticket ID for this project? (e.g. CSD-789, or 'none' to skip)"

If the user answers "none" or similar, proceed without a prefix (existing behavior). Otherwise, prefix the project name: `.forge/<ticket-id>-<project-name>/`.

When continuing an existing project (directory already exists), no ticket ID prompt is needed — just match the existing directory name.

### Type

The type is always optional. If the first non-ticket argument matches a known type (file exists in `~/.claude/skills/types/`), treat it as a type hint. Otherwise, treat it as part of the project name/description (existing behavior).

## Project Location

All files go in `.forge/<project-name>/`. Derive the name from arguments (kebab-case). When a ticket ID is present, the directory is `.forge/<ticket-id>-<project-name>/` (e.g. `.forge/CSD-789-date-picker/`).

## State Tracking

Read `.forge/<project-name>/.phase` — one word:

| `.phase` | Meaning | On re-entry |
|---|---|---|
| (missing) | New project | → Analyze |
| `questions` | Waiting for user answers | → Refine |
| `mockup-review` | Waiting for user feedback | → Mockup Review |
| `done` | Fully planned | → Multi-phase (if user wants more) |

Always write `.phase` after completing a step.

## Triage

Assess complexity before starting:

- **Quick** — clear scope, no unknowns → `idea.md` + `plan.md` → 1-2 inline questions → `task.md` + `ticket.md` → done. Skip questions.md and mockup.
- **Standard** — moderate scope, some decisions → plan → questions → refine → tasks. Mockup only if genuinely useful (UI, complex interactions).
- **Deep** — large scope, architectural decisions → full workflow including mockup. May need multiple question rounds.

Type hint biases triage — UI types default toward including mockup, infrastructure/backend types default toward skipping it.

Announce the track. User can override.

## Phase: Analyze (new project)

1. **Resolve ticket ID:** If no ticket ID was given in arguments, ask via AskUserQuestion (see Ticket ID section above). Once resolved, form the project directory name.
2. Create `.forge/<project-name>/`
3. Write `idea.md`: the original idea + your interpretation in 2-3 sentences. For ideas with code snippets, summarize intent and note referenced files rather than quoting verbatim. If a type is given, record it in idea.md (e.g., `**Type:** cloud-infra`). If a ticket ID is present, record it (e.g., `**Ticket:** CSD-789`).
4. **MANDATORY type check:** If no type was given in arguments, check for type files using `ls /Users/claude/.claude/skills/types/` via Bash (do NOT use Glob with `~` — it doesn't expand correctly). If any exist, ask the user via AskUserQuestion which type applies — list existing types as options, recommend one based on the project content, include "Uncategorized" option. Do this before writing questions or plan. If type is discovered here, update idea.md with the type.
5. If a type is known (from arguments or step 4), read `~/.claude/skills/types/<type>.md` (if it exists) for type-specific context that informs triage, questions, and planning. **Type inheritance:** If the type file contains an `**Extends:** <parent-type>` declaration, read the parent type file first, then the child. Both inform triage, questions, and planning. Child guidance takes precedence on conflicts.
6. **Explore the codebase** — read relevant files to understand what exists before planning. Use direct Read/Grep for focused searches; use Explore subagent only when broad exploration is needed. Also scan `.forge/*/idea.md` for overlapping projects — flag duplicates to the user.
7. Determine triage track
8. Write `plan.md`: Goal (one sentence), Type, Ticket (if present), Approach (3-8 steps), Open Questions, Design & Architecture Decisions, and optionally `**Mutation Testing:** yes/no` (omit to default to no mutation testing)

   **Design & Architecture Decisions format** — use this in every `plan.md`:

   ```markdown
   ## Design & Architecture Decisions

   ### <Decision Title>
   - **Context**: <Why this decision is necessary>
   - **Decision**: <What was decided>
   - **Rationale**: <Why this option was chosen>
   - **Alternatives**: <Rejected alternatives and why they were discarded>
   ```

   Include decisions identified during analysis (e.g., technology choices, data model shape, integration patterns). For quick-track projects with no significant architectural choices, include at least the primary approach decision. During Refine phase, add decisions from resolved questions here.

**Quick track:** Ask 1-2 questions via AskUserQuestion — never zero, even when the task seems clear. At minimum, ask about scope/audience for broad requests. Incorporate answers into `plan.md`: add/update the **Design & Architecture Decisions** section, remove Open Questions. → proceed to Tasks phase (same run).

**Standard/Deep:** Proceed to Questions phase (same run).

## Phase: Questions

Write `questions.md` — 3-6 questions where the wrong assumption causes rework.

```markdown
## Q1: [title]
[Why this matters]
**Recommendation:** [your opinion + reasoning]
**Answer:**

---
## Remarks
Add anything else here.
```

Set `.phase` → `questions`. Tell the user to edit the file, then run `/idea <project-name>` again.

## Phase: Refine

1. Read `questions.md` — parse answers and remarks
2. If the user answered with a question, respond inline (`**Response:**`) and ask them to review again
3. Treat `## Remarks` the same — respond inline if needed
4. If answers significantly change the approach, re-explore relevant codebase files before updating the plan. **If the user asserts something is already done or implemented, re-read the actual files NOW — never trust earlier cached reads over user assertions.**
5. When all critical questions are resolved: update `plan.md` in place
   - Add/update the **Design & Architecture Decisions** section (see format in Analyze phase)
   - Remove Open Questions
6. Decide: mockup needed?
   - Yes → proceed to Mockup phase (same run)
   - No → proceed to Tasks phase (same run)

## Phase: Mockup

Create something tangible to react to:

- **UI**: `mockup/index.html` — self-contained, inline CSS, rough
- **API/backend**: `mockup/spec.md` — endpoints, data shapes, examples
- **Architecture**: `mockup/architecture.md` — components, boundaries, data flow

Write `mockup/feedback.md` with 3 specific questions about design choices. Each question must include a `**Recommendation:**` with reasoning and an `**Answer:**` field — same format as questions.md.

Set `.phase` → `mockup-review`. Tell user to review + edit feedback.md.

## Phase: Mockup Review

1. Read `mockup/feedback.md`
2. If feedback requires significant changes: update the mockup, write new feedback questions, keep `.phase` → `mockup-review`
3. If feedback is minor or approving: apply adjustments, proceed to Tasks phase (same run)

## Phase: Tasks

1. Read all project files
2. Write `task.md`:

```markdown
# <Project Name>
**Goal:** [one sentence]

## Tasks

### 1. [Title]
**Do:** [specific enough for a subagent with no other context]
**Files:** [files to create/modify]
**Stubs:** [files that need stub implementations for TDD red phase — classes/interfaces with correct signatures but empty/default bodies, or "none" if no tests]
**Depends on:** [task numbers or "none"]
**Tests:** [test IDs from tests.md that verify this task, e.g. T1.1, T1.2]
**Done when:** [acceptance criteria]

## Parallelization
- [which tasks can run simultaneously]
- [which are sequential and why]
```

3. Write `tests.md` — define verification tests for the project:

```markdown
# Tests — <Project Name>

## Task Tests

### T1: [Task 1 title]
| ID | Test Name | Verifies | Expected Behavior | How to Run |
|---|---|---|---|---|
| T1.1 | [name] | [what it checks] | [expected outcome] | [steps to verify] |

### T2: [Task 2 title]
| ID | Test Name | Verifies | Expected Behavior | How to Run |
|---|---|---|---|---|
| T2.1 | [name] | [what it checks] | [expected outcome] | [steps to verify] |

## Integration Tests

| ID | Test Name | Verifies | Expected Behavior | How to Run |
|---|---|---|---|---|
| I1 | [name] | [cross-task behavior] | [expected outcome] | [steps to verify] |
```

   - **Task Tests:** Per-task tests that verify each task's acceptance criteria independently. Use IDs like T1.1, T1.2, T2.1, etc.
   - **Integration Tests:** Tests that require multiple or all tasks to be complete. Verify cross-task functionality and end-to-end behavior. Use IDs like I1, I2, etc.
   - Tests should be concrete and verifiable — runnable commands, file checks, or behavioral assertions.
   - **Tests must be runnable against stubs.** During the build's TDD red phase, stub implementations (correct signatures, default return values) are created before tests. Design tests so that they compile against stubs and fail with meaningful assertion errors — not compilation errors. This means tests should assert on return values, state changes, or thrown exceptions, not just call methods.
   - Each task in `task.md` must reference its test IDs in the `**Tests:**` field.
   - If mutation testing is enabled in `plan.md` (`**Mutation Testing:** yes`), consider defining tests that cover mutation-testable scenarios — boundary conditions, operator-sensitive logic, and error handling paths that a mutant could bypass.

4. Create tasks via TaskCreate. Each description references: "See `.forge/<project-name>/task.md` Task N for full context."
5. Write `ticket.md`:

```markdown
# Ticket Suggestion
**Ticket:** [ticket ID if present, otherwise omit]
**Title:** [action-oriented, under 70 chars]
**Description:** [1-2 sentence problem statement]
**Goal:** [from plan.md]
**Scope:**
- [key deliverables]
**Acceptance Criteria:**
- [ ] [from task "Done when" fields]
```

6. Set `.phase` → `done`

## Multi-phase Projects

When `.phase = done` and the user wants a follow-up phase:

1. Reset `.phase` to `questions` (or skip to Tasks for quick track)
2. Append to existing files with a phase header (e.g., `## Phase 2: [title]`)
3. Continue numbering (questions and tasks) from where the previous phase left off. TaskCreate IDs will differ — expected.

**Approach invalidation:** If user feedback after `.phase = done` invalidates the approach (not just extends it), reset `.phase` to the appropriate earlier phase (`questions` if decisions needed, `mockup` if design needs rework). Delete stale TaskCreate entries. Update plan.md with an `## Approach Change` section explaining why the original approach was abandoned. Don't let `.phase = done` prevent plan evolution.

**Concept-only guard:** When `.phase = done` and the work was described as concept/planning (not implementation), do NOT interpret user feedback as build permission. Ask explicitly: "Should I implement this, or is this still concept work?"

## Logging

After each phase, briefly reflect. If anything notable (improvisation, awkward output, unclear instructions), append to `~/.claude/skills/develop-log.md` (shared log at forge root):

```markdown
## [date] — <project-name> — Phase: <phase>
**Skill:** idea
**Track:** [quick/standard/deep]
**Task type:** [type or "untyped"]
**Worked well:** [what the skill handled correctly]
**Problems:** [what was unclear — be specific, include what you did instead]
**Proposed change:** [exact edit or "none"]
```

Always check before responding. Skip the log entry only if nothing notable happened. Include one line for the user if notable:
> _Skill note: triage picked "standard" but this felt like a "quick" — logged._

**Never edit SKILL.md or type files directly.** Only log. All curation happens via `/forge review`.

## Rules

- **Be opinionated.** Recommend, don't list options.
- **Preserve exact words.** Quote user decisions in the plan.
- **plan.md evolves in place.** One file, updated. No plan-v2.
- **Plans are mutable.** User feedback after tasks → update in place, rewrite TaskCreate entries as needed.
- **Questions must matter.** Wrong guess = rework.
- **Tasks must be self-contained.** A subagent can execute with only the task + referenced files.
- **Log after every `.phase` write.** Before the final user-facing response, write the develop-log entry FIRST, then respond. The log is part of phase completion, not an afterthought. Logging is not optional.
