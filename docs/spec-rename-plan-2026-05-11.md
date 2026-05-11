# Plan — Option (a): Rename Idea → Spec + restructure content

Implementation plan for the F-0 recommendation in [phase-shape-findings-2026-05-11.md](phase-shape-findings-2026-05-11.md).

## Decisions captured (from the question round)

1. **Timing:** Rename now; migrate the in-flight `phase-validators` workspace alongside.
2. **Content backfill:** Mechanical rename only — do NOT retroactively rewrite `phase-validators/idea.md` into the new User-stories + EARS format. Future projects start in the new format.
3. **History:** Leave `pipeline.md` History entries unchanged. Mixed-name history is acceptable; only live state migrates.

## Scope inventory (real counts)

| Category | Count | Notes |
| --- | --- | --- |
| Framework `.md` files containing "idea" | 30 | Includes `phases/idea/` directory (7 files) + cross-references in every sibling phase + orchestrator-level docs |
| JSON schema enums hardcoding "idea" | 2 | `schemas/pipeline.schema.json:21`, `schemas/events.schema.json:31` |
| Python hook with "idea" literals | 1 | `hooks/validate-subagent-output.py` at lines 11 + 63 |
| Active workspaces | 1 | `.loom/phase-validators/` — 5 files, 41 "idea" mentions (the project's seed/idea/design extensively reference `phases/idea/validator.md` as the reference shape) |

Each of the four non-Idea phases now has a `validator.md` (`design/validator.md`, `plan/validator.md`, `build/validator.md`, `idea/validator.md`) — these were authored as part of the in-flight `phase-validators` project's prior phases. The rename touches their cross-references too.

## Phasing — atomic stages

Stages are sized so each can be committed independently. Stage N may assume Stages 1..N-1 landed. Each stage ends in a runnable state.

---

### Stage 1 — Framework rename (mechanical, no content changes)

**Goal:** `phases/idea/` becomes `phases/spec/` everywhere in the framework. All path references, phase enums, and string literals updated. Content unchanged.

**File operations:**

1. `git mv orchestrator/weave/phases/idea orchestrator/weave/phases/spec` (preserves history)
2. Internal renames within the moved directory:
   - `spec/agent.md` line 77: `enum: [idea]` → `enum: [spec]`
   - `spec/validator.md`: replace `# Idea Validator` → `# Spec Validator`; update intro paragraph
   - `spec/methods/grilling.md`: `# Grilling Rules` (intro line: `Idea-phase grilling discipline.` → `Spec-phase grilling discipline.`)
   - `spec/methods/categories.md`: any literal "Idea" references → "Spec"

3. Parser + schemas + hook:
   - `orchestrator/lib/pipeline-parser.py`: `VALID_PHASES = {..., "spec"}` (replace `"idea"`); update `initial_pipeline` template `Current phase: spec`; `Resume point: spec:foundation`
   - `orchestrator/schemas/pipeline.schema.json:21`: enum `["spec", "design", "plan", "build", "review"]`
   - `orchestrator/schemas/events.schema.json:31`: enum `[null, "spec", "design", "plan", "build", "review", "quality-check"]`
   - `orchestrator/hooks/validate-subagent-output.py`: lines 11 + 63 — replace `"idea"` with `"spec"`

4. Orchestrator docs (text replaces, path replaces):
   - `orchestrator/weave/SKILL.md`: Load Order step 4, gate prompts, Direct Questions section. Replace `phases/idea/` → `phases/spec/`. Replace literal "Idea" in user-facing strings → "Spec" where it refers to the phase name. (Where it refers to a *concept like "an idea"*, leave alone.)
   - `orchestrator/weave/contract.md`: state preconditions enum, Phases dispatched list (line 84)
   - `orchestrator/weave/methods/find-project.md`, `create-project.md`, `recovery.md`
   - `orchestrator/weave/_preamble.txt`

5. Sibling phase docs (path references only — content otherwise unchanged):
   - `phases/{design,plan,build,review}/agent.md` and `contract.md`: replace `idea.md` → `spec.md`, `phases/idea/` → `phases/spec/`
   - `phases/build/methods/{task-builder,smoke-test,mutation-test}.md`
   - `phases/review/artifact.md`

6. Top-level orchestrator docs:
   - `orchestrator/README.md` Layout table
   - `orchestrator/tune/README.md`, `tune/SKILL.md`
   - `orchestrator/types/ciso-tool.md` (if it references "idea phase")
   - `orchestrator/lib/artifacts.sh` if it has any literal `"idea"` paths

7. Repo-level docs:
   - `docs/overview.md`

**Mechanical strategy:** one pass with structured substitution. Where the literal is a path (`phases/idea/`, `idea.md`, `idea:foundation`), it's a safe direct replace. Where it's the word "Idea" in prose, audit each match — some refer to the phase name (replace) and some may refer to a generic concept (leave). Rough estimate: 60-70 path replacements + 20-30 prose replacements after audit.

**End-of-stage validation:**
- `pipeline-parser.py init . sanity-rename` produces a workspace with `Current phase: spec`.
- `pipeline-parser.py validate` accepts the new file.
- The hook script accepts a phase=spec record.
- `git grep -i "phases/idea\|idea\.md\|: idea$" orchestrator/` returns zero hits.

**Risk:** moderate. Mechanical replaces in 30 files. Easy to miss a literal. Mitigation: grep-clean validation at end of stage.

**Commit message suggestion:** `rename phases/idea/ → phases/spec/ — framework references only, no content changes`

---

### Stage 2 — Spec artifact restructure (content)

**Goal:** Add User stories + EARS acceptance criteria to `spec.md`. Remove `Expected behavior` and `Acceptance boundaries` (folded into per-story AC).

**Files touched:**

1. `phases/spec/artifact.md` — rewrite the section list. New required sections:
   ```
   - Front matter (project, created)
   - What we're building
   - Users and value
   - Scope
   - Out of scope
   - User stories (with per-story acceptance criteria in EARS notation)
   - Constraints
   - Open ambiguity
   ```
   Drop `Expected behavior` and `Acceptance boundaries` from required sections.

2. `phases/spec/agent.md` — update the agent spec:
   - Add a `## User stories` section to its writes list (under `spec.md`).
   - Update the Work Loop to include a "story elicitation" step after Foundation, before/during Branching.
   - Update the canonical `spec.md` section list (lines 43-54 of the current `idea/agent.md`) to match the new artifact contract.

3. `phases/spec/methods/grilling.md` — light touch:
   - Foundation→Branching staging stays as-is (still applies to story elicitation).
   - Add a paragraph in §2 acknowledging that Branching now also elicits **stories with acceptance criteria** in addition to decisions.

4. `phases/spec/methods/categories.md` — moderate touch:
   - Existing categories (Y/N, Choice, Architecture, Background, Open) stay.
   - Add a **new category: Story** with template for story elicitation:
     - Briefing block format: *"What's the user trying to do? Who is the user? What's the value?"*
     - Story marker shape: `<!-- loom:story id=US-NN -->`...`<!-- loom:story-end id=US-NN -->`
     - Story body: `As a <role>, I want <action>, so that <value>.`
     - Per-story acceptance criteria block: EARS format (`WHEN/IF/WHILE/WHERE <trigger> THEN the system SHALL <response>`)
   - Numbering: stories use `US-001`, `US-002`, ... (separate from decisions Q-NN).

**Concrete story template** the agent must produce (this is the load-bearing piece):

```markdown
### US-001: <one-line title>
<!-- loom:story id=US-001 status=active -->

**Story:** As a <role>, I want <action>, so that <value>.

**Acceptance criteria:**
1. WHEN <trigger>, the system SHALL <response>.
2. IF <unwanted trigger>, then the system SHALL <recovery response>.
3. WHILE <state>, the system SHALL <state-specific response>.
<!-- loom:story-end id=US-001 -->
```

Each acceptance criterion is one EARS clause. The agent emits one of the five patterns (Ubiquitous / State-driven / Event-driven / Optional feature / Unwanted behavior) per AC.

**End-of-stage validation:** A test `/weave` on a trivial seed produces a `spec.md` with at least one `## User stories` section containing one or more `US-NNN` blocks, each with EARS-format AC.

**Risk:** medium. The agent prompt for story elicitation needs care — bad prompts produce bad stories. Mitigation: include the template verbatim in `spec/methods/categories.md` so the agent has a literal example.

**Commit message suggestion:** `spec phase: add User stories + EARS acceptance criteria; drop Expected behavior / Acceptance boundaries`

---

### Stage 3 — Design artifact restructure

**Goal:** Remove `User flows` from `design.md`. Design becomes pure HOW.

**Files touched:**

1. `phases/design/artifact.md` — update required sections list. The current text already keeps `idea.md` constraints and lists structural sections; just ensure `User flows` is not required (and ideally explicitly mention it doesn't belong here).

2. `phases/design/agent.md` — the `## design.md / Required sections:` list (currently at line 48 of current `design/agent.md`). Remove `User flows`. The new required sections:
   ```
   - System shape
   - Interfaces
   - Data model
   - Integration points
   - State and error handling
   - Constraints
   - Alternatives considered
   - Open ambiguity
   ```
   Note: `Constraints` here means *technical* constraints (Design's structural envelope). Spec already has its own user-facing/business `Constraints`. Document the distinction in design/artifact.md to prevent regression.

3. Update Design's `## Reads` list to read `spec.md` (post-Stage-1 it already does) and explicitly reference the User stories section.

**End-of-stage validation:** A test `/weave` design.md doesn't have a `User flows` section.

**Risk:** small. Single-section deletion from a template + a "don't restate stories" note.

**Commit message suggestion:** `design phase: drop User flows (lives in spec.md as user stories)`

---

### Stage 4 — Plan reads stories from spec.md

**Goal:** Plan no longer "extracts user stories from Idea and Design". Plan reads stories directly from `spec.md` with story IDs and references those IDs in `task.md`.

**Files touched:**

1. `phases/plan/agent.md`:
   - Line 26: `Extract user stories from Idea and Design.` → `Read user stories from spec.md. Each story has a stable US-NNN ID and EARS-format acceptance criteria; tasks reference the stories they satisfy by ID.`
   - `## Reads` list: ensure `spec.md` is named (post-Stage-1 already done; verify).
   - Task File Required Fields: add `satisfies-stories: [US-NNN, ...]` (or extend the existing `covers:` field's meaning if that's what it currently does).

2. `phases/plan/artifact.md`:
   - Line 16: `Every user story is covered by at least one task.` — keep but reword to reference the stable IDs: `Every US-NNN story from spec.md is covered by at least one task (referenced via the task's satisfies-stories field).`

3. `phases/plan/validator.md` (already exists from phase-validators run):
   - Check that the validator's `Checks` table includes a "Story coverage" row (every US-NNN in spec.md mapped to at least one task). If absent, add it.

**End-of-stage validation:** Run a small `/weave` end-to-end — Plan's task files reference `US-NNN` story IDs from spec.md.

**Risk:** small. Three text edits + one validator-check addition.

**Commit message suggestion:** `plan phase: tasks reference US-NNN story IDs from spec.md (no more story scraping)`

---

### Stage 5 — Migrate `.loom/phase-validators/` workspace

**Goal:** Active workspace works under the renamed framework. Mechanical rename per the question-round decision.

**File operations:**

1. `git mv .loom/phase-validators/idea.md .loom/phase-validators/spec.md` (preserves history)
2. Inside `.loom/phase-validators/` files, replace **framework path references**:
   - `phases/idea/validator.md` → `phases/spec/validator.md` (this is the project's reference shape; it's a path, not project intent)
   - `phases/idea/` → `phases/spec/`
   - These appear heavily in `spec.md` (was idea.md), `design.md`, `decisions.md`. Decisions about WHICH validators to author (design/plan/build) don't change.
3. `pipeline.md`:
   - `Current phase` → currently `design`; leave as-is (the project is mid-flight at Design, not Idea).
   - `Produced artifacts` list: rename `idea.md` → `spec.md` entry.
   - `Resume point`: currently `design:start`; leave as-is.
   - **History section:** leave unchanged per decision 3.
4. `artifacts.json`: update path entry `idea.md` → `spec.md`.

**What does NOT change in this workspace:**

- The project's intent. It's still "add validators for design/plan/build". Per phase-validators' own Q02 grilling decision, Review is intentionally excluded — that stands.
- The project's `design.md` content (out of scope per content-backfill decision).
- The project's `decisions.md` content (just path references inside).
- The project does NOT get retroactively rewritten in the new User stories + EARS format. Its spec.md keeps the old `## Expected behavior` shape. Slightly inconsistent with framework-new but expected per the question-round decision.

**End-of-stage validation:**
- `pipeline-parser.py read .loom/phase-validators/pipeline.md` shows `Current phase: design`, no validation errors.
- `pipeline-parser.py validate` passes.
- Resuming `/weave` on the workspace dispatches the Design Quality Check or advances to Plan (depending on user choice).

**Risk:** medium. The phase-validators project's CONTENT references the Idea validator extensively. The rename is mechanical but the artifact reads "differently" after the rename — e.g. `design.md` now talks about modeling validators after `phases/spec/validator.md`. That's semantically the same but visually new.

**Commit message suggestion:** `migrate phase-validators workspace to phases/spec/ naming (mechanical rename, no content rewrite)`

---

### Stage 6 — Validation pass

**Goal:** verify the rename + restructure landed cleanly.

**Checks:**

1. `grep -rn "phases/idea\|idea\.md\|: idea$" orchestrator/` returns zero hits (excluding `.loom/*/pipeline.md` History tables which are historical).
2. `pipeline-parser.py init . validation-check && pipeline-parser.py read .loom/validation-check/pipeline.md` shows `Current phase: spec`, `Resume point: spec:foundation`.
3. `phases/spec/artifact.md` and `phases/design/artifact.md` reflect the new section lists.
4. Run a tiny end-to-end `/weave` (e.g. seed: "single-page hello-world HTML") through Spec → Design → Plan. Verify:
   - `spec.md` has a `## User stories` section with at least one `US-NNN` block in EARS format.
   - `design.md` has no `## User flows` section.
   - `task.md` references stories by ID.
5. `phase-validators` workspace resumes cleanly.

**Risk:** the test `/weave` itself surfaces bugs. Mitigation: triage and fix; this is the value of the validation pass.

---

## Risks (cross-stage)

1. **Hardcoded literals slip through.** Especially JSON schema enums and the Python hook — those don't grep as cleanly as Markdown. Mitigation: explicit checklist in Stage 1; final grep at the end of the stage.
2. **Phase-validators project context shifts under it.** Its `idea.md` (now `spec.md`) reads as referencing `phases/spec/validator.md`, which is a name that didn't exist when the project was scoped. Mid-flight project SHOULD survive this if the path-references are consistent — Plan and Build will read `phases/spec/validator.md` as the reference shape and produce sibling validators. Mitigation: after the migration, manually re-read the workspace's spec.md/design.md to confirm semantic continuity before resuming `/weave`.
3. **Mockups / preview / variant-choose** (the deferred half of the framework direction from F-1's related observation) are NOT addressed by this plan. If you want those next, that's a follow-on plan.
4. **`Acceptance boundaries` folded into stories.** Stories now carry their own acceptance criteria. Some projects may have used the old `Acceptance boundaries` section as a system-wide check list (not per-story). Need to decide: are those system-wide ACs absorbed into a "universal" story, or expressed as Constraints? Mitigation: document the policy in `spec/artifact.md` Stage 2 — if a check is universal, file it under Constraints; if it's user-observable, give it a story.

## Open questions (resolve before / during Stage 2)

1. **Story numbering scheme.** `US-001`, `US-002`, ... contiguous per-project? Or `US-<scope>-NN`? Recommendation: contiguous per-project, simplest. Plan tasks reference them as `US-NNN` (zero-padded to 3 digits).

2. **EARS pattern selection.** Should `spec/methods/categories.md` enforce one EARS pattern per AC (so the agent picks the right one) or allow free EARS prose? Recommendation: enforce — emit the pattern keyword (`WHEN` / `WHILE` / `IF` / `WHERE`) explicitly at the start of each AC so each clause is parseable.

3. **Universal acceptance vs per-story.** If a project has a universal acceptance check (e.g. "all forms validate inputs"), is it: (a) folded into a "universal" `US-000: As a user, I want any input I provide to be validated"`, (b) listed under `Constraints`, or (c) a separate `## System-wide acceptance` section? Recommendation: (b) — Constraints is the natural home for universal envelope conditions; stories are user-action-shaped.

4. **Story status field.** The decisions parser tracks `Status: answered/awaiting-answer/...` for Q-NN. Should stories have a similar status (e.g. `active/superseded/deferred`)? Recommendation: yes — same vocabulary as decisions for consistency. Plan reads only `Status: active` stories.

5. **Validator coverage of stories.** The Spec validator (`phases/spec/validator.md`) currently looks for "blind spots", "wrong assumptions", etc. against the seed. After Stage 2, the validator should also check: every user story has at least one AC; every AC is in valid EARS form. Recommendation: add a "Story shape" check row to the validator's Checks table.

## Rollback path

Each stage is one commit; revert by `git revert <stage-commit>`. The framework-rename stage (Stage 1) is the largest revert; the workspace-migration stage (Stage 5) is reversible on its own (mv back, fix path references in the project's files).

The JSON schema and Python hook changes in Stage 1 are tightly coupled to the parser change — they must revert together or the parser fails to validate. Group those in one sub-commit if you commit Stage 1 in parts.

## Estimated effort

- Stage 1: 1–2 hours (mostly mechanical; risk in the grep audit)
- Stage 2: 2–3 hours (template authoring; the load-bearing piece)
- Stage 3: 30 minutes (single-section deletion)
- Stage 4: 30 minutes (three text edits + validator check)
- Stage 5: 30 minutes (mechanical migration)
- Stage 6: 30 minutes (smoke test + triage)

**Total: ~5–7 hours of focused work** if no surprises. Plan for ~8 to absorb friction.

## Suggested order of approval

1. Approve this plan as-is, or flag concerns on any specific stage.
2. I execute stages 1 → 6 in order. Each stage commits independently so you can pause / inspect between them.
3. After Stage 1 and Stage 5 are visibly green (new workspaces validate, phase-validators resumes), the rest is template authoring that can be reviewed inline.

### Your answer / changes
<!-- fill in: approve as-is, request changes to a specific stage, or flag concerns -->
